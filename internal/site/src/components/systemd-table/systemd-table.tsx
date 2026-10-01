// Model-output: Claude Fable 5
// Model-output: Claude Opus 5.5
import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import {
	type ColumnFiltersState,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getSortedRowModel,
	type Row,
	type SortingState,
	type Table as TableType,
	useReactTable,
	type VisibilityState,
} from "@tanstack/react-table"
import { useWindowVirtualizer, type VirtualItem } from "@tanstack/react-virtual"
import { LoaderCircleIcon, MaximizeIcon, RefreshCwIcon } from "lucide-react"
import { listenKeys } from "nanostores"
import { memo, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { getStatusColor, systemdTableCols } from "@/components/systemd-table/systemd-table-columns"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { LogsDisplay, LogsFullscreenDialog, LogsIconButton, LogsTimestampToggle } from "@/components/logs-display"
import { getLogTimestampDecorations } from "@/lib/logs"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { pb } from "@/lib/api"
import { ServiceStatus, ServiceStatusLabels, type ServiceSubState, ServiceSubStateLabels } from "@/lib/enums"
import { $allSystemsById } from "@/lib/stores"
import { cn, decimalString, formatBytes, useBrowserStorage } from "@/lib/utils"
import type { SystemdRecord, SystemdServiceDetails } from "@/types"
import { Separator } from "../ui/separator"

const syntaxTheme = "github-dark-dimmed"

async function getSystemdLogsHtml(systemId: string, serviceName: string): Promise<string> {
	const [{ highlighter }, { logs }] = await Promise.all([
		import("@/lib/shiki"),
		pb.send<{ logs: string }>("/api/beszel/systemd/logs", {
			requestKey: null,
			query: { system: systemId, service: serviceName },
		}),
	])
	return logs
		? highlighter.codeToHtml(logs, {
				lang: "log",
				theme: syntaxTheme,
				decorations: getLogTimestampDecorations(logs),
			})
		: ""
}

/**
 * Height of a table row, in px. Matches the systems table's row height so the two tables share
 * one visual rhythm: the tallest cell content (a badge or a line of text) plus breathing room
 * and the collapsed row border.
 */
const ROW_HEIGHT = 42
/** Height of the table header, in px: an h-12 cell plus its 2px bottom border. */
const HEADER_HEIGHT = 50

export default function SystemdTable({ systemId }: { systemId?: string }) {
	const loadTime = Date.now()
	const [data, setData] = useState<SystemdRecord[]>([])
	const [sorting, setSorting] = useBrowserStorage<SortingState>(
		`sort-sd-${systemId ? 1 : 0}`,
		[{ id: systemId ? "name" : "system", desc: false }],
		sessionStorage
	)
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
	const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
	const [globalFilter, setGlobalFilter] = useState("")

	// clear old data when systemId changes
	useEffect(() => {
		return setData([])
	}, [systemId])

	useEffect(() => {
		const lastUpdated = data[0]?.updated ?? 0

		function fetchData(systemId?: string) {
			pb.collection<SystemdRecord>("systemd_services")
				.getList(0, 2000, {
					fields: "name,state,sub,cpu,cpuPeak,memory,memPeak,updated",
					filter: systemId ? pb.filter("system={:system}", { system: systemId }) : undefined,
				})
				.then(
					({ items }) =>
						items.length &&
						setData((curItems) => {
							const lastUpdated = Math.max(items[0].updated, items.at(-1)?.updated ?? 0)
							const systemdNames = new Set()
							const newItems: SystemdRecord[] = []
							for (const item of items) {
								if (Math.abs(lastUpdated - item.updated) < 70_000) {
									systemdNames.add(item.name)
									newItems.push(item)
								}
							}
							for (const item of curItems) {
								if (!systemdNames.has(item.name) && lastUpdated - item.updated < 70_000) {
									newItems.push(item)
								}
							}
							return newItems
						})
				)
		}

		// initial load
		fetchData(systemId)

		// if no systemId, pull system containers after every system update
		if (!systemId) {
			return $allSystemsById.listen((_value, _oldValue, systemId) => {
				// exclude initial load of systems
				if (Date.now() - loadTime > 500) {
					fetchData(systemId)
				}
			})
		}

		// if systemId, fetch containers after the system is updated
		return listenKeys($allSystemsById, [systemId], (_newSystems) => {
			// don't fetch data if the last update is less than 9.5 minutes
			if (lastUpdated > Date.now() - 9.5 * 60 * 1000) {
				return
			}
			fetchData(systemId)
		})
	}, [systemId])

	const table = useReactTable({
		data,
		// columns: systemdTableCols.filter((col) => (systemId ? col.id !== "system" : true)),
		columns: systemdTableCols,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		onSortingChange: setSorting,
		onColumnFiltersChange: setColumnFilters,
		onColumnVisibilityChange: setColumnVisibility,
		defaultColumn: {
			sortUndefined: "last",
			size: 100,
			minSize: 0,
		},
		state: {
			sorting,
			columnFilters,
			columnVisibility,
			globalFilter,
		},
		onGlobalFilterChange: setGlobalFilter,
		globalFilterFn: (row, _columnId, filterValue) => {
			const service = row.original
			const systemName = $allSystemsById.get()[service.system]?.name ?? ""
			const name = service.name ?? ""
			const statusLabel = ServiceStatusLabels[service.state as ServiceStatus] ?? ""
			const subState = service.sub ?? ""
			const searchString = `${systemName} ${name} ${statusLabel} ${subState}`.toLowerCase()

			return (filterValue as string)
				.toLowerCase()
				.split(" ")
				.every((term) => searchString.includes(term))
		},
	})

	const rows = table.getRowModel().rows
	const visibleColumns = table.getVisibleLeafColumns()

	const statusTotals = useMemo(() => {
		const totals = [0, 0, 0, 0, 0, 0]
		for (const service of data) {
			totals[service.state]++
		}
		return totals
	}, [data])

	if (!data.length && !globalFilter) {
		return null
	}

	return (
		// w-min lets the card grow past the layout width rather than let the table overflow the card
		<Card className="w-min min-w-full px-3 py-5 sm:py-6 sm:px-6">
			<CardHeader className="p-0 mb-3 sm:mb-4">
				<div className="grid md:flex gap-x-5 gap-y-3 w-full items-end">
					<div className="px-2 sm:px-1">
						<CardTitle className="mb-2">
							<Trans>Systemd services</Trans>
						</CardTitle>
						<div className="text-sm text-muted-foreground flex items-center flex-wrap">
							<Trans>Total: {data.length}</Trans>
							<Separator orientation="vertical" className="h-4 mx-2 bg-primary/40" />
							<Trans>Failed: {statusTotals[ServiceStatus.Failed]}</Trans>
							<Separator orientation="vertical" className="h-4 mx-2 bg-primary/40" />
							<Trans>Updated every 10 minutes.</Trans>
						</div>
					</div>
					<Input
						placeholder={t`Filter...`}
						value={globalFilter}
						onChange={(e) => setGlobalFilter(e.target.value)}
						className="ms-auto px-4 w-full max-w-full md:w-64"
					/>
				</div>
			</CardHeader>
			<div className="rounded-md">
				<AllSystemdTable table={table} rows={rows} colLength={visibleColumns.length} systemId={systemId} />
			</div>
		</Card>
	)
}

const AllSystemdTable = memo(function AllSystemdTable({
	table,
	rows,
	colLength,
	systemId,
}: {
	table: TableType<SystemdRecord>
	rows: Row<SystemdRecord>[]
	colLength: number
	systemId?: string
}) {
	// The page is the scroll container, so the virtualizer tracks the window and needs to know
	// how far down the page the first row starts. Anything above it (charts, header) can change
	// height at any time, so re-measure whenever the page reflows.
	const table_ref = useRef<HTMLDivElement>(null)
	const [scroll_margin, set_scroll_margin] = useState(0)
	const activeService = useRef<SystemdRecord | null>(null)
	const [sheetOpen, setSheetOpen] = useState(false)
	const [sheetSession, setSheetSession] = useState(0)
	const openSheet = (service: SystemdRecord) => {
		activeService.current = service
		setSheetSession((session) => session + 1)
		setSheetOpen(true)
	}

	useLayoutEffect(() => {
		const table_el = table_ref.current
		if (!table_el) {
			return
		}
		// offsetTop would be relative to the nearest positioned ancestor, not the page
		const measure = () => set_scroll_margin(table_el.getBoundingClientRect().top + window.scrollY + HEADER_HEIGHT)
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(document.body)
		return () => observer.disconnect()
	}, [])

	const virtualizer = useWindowVirtualizer<HTMLTableRowElement>({
		count: rows.length,
		estimateSize: () => ROW_HEIGHT,
		overscan: 5,
		scrollMargin: scroll_margin,
	})
	const virtualRows = virtualizer.getVirtualItems()

	// stand in for the rows above and below the ones we render. virtual item offsets are
	// page-relative, so take out the offset of the first row.
	const first_virtual_row = virtualRows[0]
	const last_virtual_row = virtualRows[virtualRows.length - 1]
	const paddingTop = first_virtual_row ? Math.max(0, first_virtual_row.start - scroll_margin) : 0
	const paddingBottom = last_virtual_row
		? Math.max(0, virtualizer.getTotalSize() - (last_virtual_row.end - scroll_margin))
		: 0

	return (
		<div
			className={cn(
				"h-min relative border rounded-md",
				// only needed to give the empty state room
				!rows.length && "min-h-50"
			)}
			ref={table_ref}
		>
			{/* add header height to table size */}
			<div style={{ height: `${virtualizer.getTotalSize() + HEADER_HEIGHT}px`, paddingTop, paddingBottom }}>
				<table className="text-sm w-full h-full text-nowrap">
					<SystemdTableHead table={table} />
					<TableBody>
						{rows.length ? (
							virtualRows.map((virtualRow) => {
								const row = rows[virtualRow.index]
								return <SystemdTableRow key={row.id} row={row} virtualRow={virtualRow} openSheet={openSheet} />
							})
						) : (
							<TableRow>
								<TableCell colSpan={colLength} className="h-37 text-center pointer-events-none">
									<Trans>No results.</Trans>
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</table>
			</div>
			<SystemdSheet
				key={sheetSession}
				sheetOpen={sheetOpen}
				setSheetOpen={setSheetOpen}
				activeService={activeService}
				systemId={systemId}
			/>
		</div>
	)
})

function SystemdSheet({
	sheetOpen,
	setSheetOpen,
	activeService,
	systemId,
}: {
	sheetOpen: boolean
	setSheetOpen: (open: boolean) => void
	activeService: React.RefObject<SystemdRecord | null>
	systemId?: string
}) {
	const service = activeService.current
	const targetSystemId = systemId ?? service?.system
	const canReadLogs = !!targetSystemId && !!$allSystemsById.get()[targetSystemId]?.info?.jl
	const [details, setDetails] = useState<SystemdServiceDetails | null>(null)
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [logs, setLogs] = useState("")
	const [logsStatus, setLogsStatus] = useState<"loading" | "ready" | "empty" | "error">("loading")
	const [isLoadingLogs, setIsLoadingLogs] = useState(false)
	const [logsFullscreenOpen, setLogsFullscreenOpen] = useState(false)
	const logsContainerRef = useRef<HTMLDivElement>(null)
	const logsRequestId = useRef(0)

	const scrollLogsToBottom = () => {
		if (logsContainerRef.current) {
			logsContainerRef.current.scrollTo({ top: logsContainerRef.current.scrollHeight })
		}
	}

	useEffect(() => {
		if (!sheetOpen || !service) {
			return
		}

		setError(null)

		let cancelled = false
		setDetails(null)
		setIsLoading(true)

		pb.send<{ details: SystemdServiceDetails }>("/api/beszel/systemd/info", {
			query: {
				system: targetSystemId,
				service: service.name,
			},
		})
			.then(({ details }) => {
				if (cancelled) return
				if (details) {
					setDetails(details)
				} else {
					setDetails(null)
					setError(t`No results found.`)
				}
			})
			.catch((err) => {
				if (cancelled) return
				setError(err?.message ?? "Failed to load service details")
				setDetails(null)
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoading(false)
				}
			})

		return () => {
			cancelled = true
		}
	}, [sheetOpen, service, targetSystemId])

	const loadLogs = async () => {
		if (!service || !targetSystemId || !canReadLogs) return

		const requestId = ++logsRequestId.current
		setLogsStatus(logs ? "ready" : "loading")
		setIsLoadingLogs(true)
		try {
			const logs = await getSystemdLogsHtml(targetSystemId, service.name)
			if (requestId !== logsRequestId.current) return
			setLogs(logs)
			setLogsStatus(logs ? "ready" : "empty")
		} catch (err) {
			if (requestId !== logsRequestId.current) return
			console.error(err)
			setLogsStatus("error")
		} finally {
			if (requestId === logsRequestId.current) setIsLoadingLogs(false)
		}
	}

	useEffect(() => {
		if (sheetOpen && canReadLogs) {
			loadLogs()
		}
		return () => {
			logsRequestId.current++
		}
	}, [sheetOpen, service, targetSystemId, canReadLogs])

	useEffect(() => {
		if (!sheetOpen) setLogsFullscreenOpen(false)
	}, [sheetOpen])

	useEffect(() => {
		if (logs) {
			setTimeout(scrollLogsToBottom, 20)
		}
	}, [logs])

	if (!service) return null

	const statusLabel = ServiceStatusLabels[service.state as ServiceStatus] ?? ""
	const subStateLabel = ServiceSubStateLabels[service.sub as ServiceSubState] ?? ""

	const notAvailable = <span className="text-muted-foreground">N/A</span>

	const formatMemory = (value?: number | null) => {
		if (value === undefined || value === null) {
			return value === null ? t`Unlimited` : undefined
		}
		const { value: convertedValue, unit } = formatBytes(value, false, undefined, false)
		const digits = convertedValue >= 10 ? 1 : 2
		return `${decimalString(convertedValue, digits)} ${unit}`
	}

	const formatCpuTime = (ns?: number) => {
		if (!ns) return undefined
		const seconds = ns / 1_000_000_000
		if (seconds >= 3600) {
			const hours = Math.floor(seconds / 3600)
			const minutes = Math.floor((seconds % 3600) / 60)
			const secs = Math.floor(seconds % 60)
			return [hours ? `${hours}h` : null, minutes ? `${minutes}m` : null, secs ? `${secs}s` : null]
				.filter(Boolean)
				.join(" ")
		}
		if (seconds >= 60) {
			const minutes = Math.floor(seconds / 60)
			const secs = Math.floor(seconds % 60)
			return `${minutes}m ${secs}s`
		}
		if (seconds >= 1) {
			return `${decimalString(seconds, 2)}s`
		}
		return `${decimalString(seconds * 1000, 2)}ms`
	}

	const formatTasks = (current?: number, max?: number) => {
		const hasCurrent = typeof current === "number" && current >= 0
		const hasMax = typeof max === "number" && max > 0 && max !== null
		if (!hasCurrent && !hasMax) {
			return undefined
		}
		return (
			<>
				{hasCurrent ? current : notAvailable}
				{hasMax && <span className="text-muted-foreground ms-1.5">{`(${t`limit`}: ${max})`}</span>}
				{max === null && (
					<span className="text-muted-foreground ms-1.5">{`(${t`limit`}: ${t`Unlimited`.toLowerCase()})`}</span>
				)}
			</>
		)
	}

	const formatTimestamp = (timestamp?: number) => {
		if (!timestamp) return undefined
		// systemd timestamps are in microseconds, convert to milliseconds for JavaScript Date
		const date = new Date(timestamp / 1000)
		if (Number.isNaN(date.getTime())) return undefined
		return date.toLocaleString()
	}

	const activeStateValue = (() => {
		const stateText = details?.ActiveState
			? details.SubState
				? `${details.ActiveState} (${details.SubState})`
				: details.ActiveState
			: subStateLabel
				? `${statusLabel} (${subStateLabel})`
				: statusLabel

		for (const [index, status] of ServiceStatusLabels.entries()) {
			if (details?.ActiveState?.toLowerCase() === status.toLowerCase()) {
				service.state = index as ServiceStatus
				break
			}
		}

		return (
			<div className="flex items-center gap-2">
				<div className={cn("w-2 h-2 rounded-full flex-shrink-0", getStatusColor(service.state))} />
				{stateText}
			</div>
		)
	})()

	const statusTextValue = details?.Result

	const cpuTime = formatCpuTime(details?.CPUUsageNSec)
	const tasks = formatTasks(details?.TasksCurrent, details?.TasksMax)
	const memoryCurrent = formatMemory(details?.MemoryCurrent)
	const memoryPeak = formatMemory(details?.MemoryPeak)
	const memoryLimit = formatMemory(details?.MemoryLimit)
	const restartsValue = typeof details?.NRestarts === "number" ? details.NRestarts : undefined
	const mainPidValue = typeof details?.MainPID === "number" && details.MainPID > 0 ? details.MainPID : undefined
	const execMainPidValue =
		typeof details?.ExecMainPID === "number" && details.ExecMainPID > 0 && details.ExecMainPID !== details?.MainPID
			? details.ExecMainPID
			: undefined
	const activeEnterTimestamp = formatTimestamp(details?.ActiveEnterTimestamp)
	const activeExitTimestamp = formatTimestamp(details?.ActiveExitTimestamp)
	const inactiveEnterTimestamp = formatTimestamp(details?.InactiveEnterTimestamp)
	const execMainStartTimestamp = undefined // Property not available in current systemd interface

	const renderRow = (key: string, label: ReactNode, value?: ReactNode, alwaysShow = false) => {
		if (!alwaysShow && (value === undefined || value === null || value === "")) {
			return null
		}
		return (
			<tr key={key} className="border-b last:border-b-0">
				<td className="px-3 py-2 font-medium bg-muted dark:bg-muted/40 align-top w-35">{label}</td>
				<td className="px-3 py-2">{value ?? notAvailable}</td>
			</tr>
		)
	}

	return (
		<Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
			<LogsFullscreenDialog
				open={logsFullscreenOpen && !!logs}
				onOpenChange={setLogsFullscreenOpen}
				logsDisplay={logs}
				name={service.name}
				onRefresh={loadLogs}
				isRefreshing={isLoadingLogs}
			/>
			<SheetContent className="w-full min-w-0 sm:max-w-220 p-6 overflow-y-auto">
				<SheetHeader className="p-0">
					<SheetTitle>
						<Trans>Service details</Trans>
					</SheetTitle>
					<SheetDescription className="sr-only">{service.name}</SheetDescription>
				</SheetHeader>
				<div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
					{canReadLogs && (
						<div className="min-w-0">
							<div className="flex items-center mb-3">
								<h3 className="text-sm font-medium">
									<Trans>Logs</Trans>
								</h3>
								<LogsTimestampToggle className="ms-auto" />
								<LogsIconButton label={t`Refresh`} onClick={loadLogs} disabled={isLoadingLogs}>
									<RefreshCwIcon
										className={cn("size-4 transition-transform duration-300", isLoadingLogs && "animate-spin")}
									/>
								</LogsIconButton>
								<LogsIconButton label={t`Fullscreen`} onClick={() => setLogsFullscreenOpen(true)} disabled={!logs}>
									<MaximizeIcon className="size-4" />
								</LogsIconButton>
							</div>
							{logs ? (
								<LogsDisplay logsDisplay={logs} containerRef={logsContainerRef} />
							) : logsStatus === "loading" ? (
								<>
									<div className="h-28" aria-busy="true">
										<LogsDisplay logsDisplay="" containerRef={logsContainerRef} />
									</div>
									<output className="sr-only">
										<Trans>Loading...</Trans>
									</output>
								</>
							) : (
								<output className="flex min-h-28 items-center justify-center rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
									{logsStatus === "error" ? <Trans>Failed to load logs.</Trans> : <Trans>No logs found.</Trans>}
								</output>
							)}
							{logs && logsStatus === "error" && (
								<output className="mt-2 block text-sm text-destructive">
									<Trans>Failed to load logs.</Trans>
								</output>
							)}
						</div>
					)}

					{error && (
						<Alert className="border-destructive/50 text-destructive dark:border-destructive/60 dark:text-destructive">
							<AlertTitle>
								<Trans>Error</Trans>
							</AlertTitle>
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					)}
					{isLoading && (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<LoaderCircleIcon className="size-4 animate-spin" />
							<Trans>Loading...</Trans>
						</div>
					)}

					<div>
						<div className="border rounded-md">
							<table className="w-full text-sm">
								<tbody>
									{renderRow("name", t`Name`, service.name, true)}
									{renderRow("description", t`Description`, details?.Description, true)}
									{renderRow("loadState", t`Load state`, details?.LoadState, true)}
									{renderRow(
										"bootState",
										t`Boot state`,
										<div className="flex items-center">
											{details?.UnitFileState}
											{details?.UnitFilePreset && (
												<span className="text-muted-foreground ms-1.5">(preset: {details?.UnitFilePreset})</span>
											)}
										</div>,
										true
									)}
									{renderRow("unitFile", t`Unit file`, details?.FragmentPath, true)}
									{renderRow("active", t`Active state`, activeStateValue, true)}
									{renderRow("status", t`Status`, statusTextValue, true)}
									{renderRow(
										"documentation",
										t`Documentation`,
										Array.isArray(details?.Documentation) && details.Documentation.length > 0
											? details.Documentation.join(", ")
											: undefined
									)}
								</tbody>
							</table>
						</div>
					</div>

					<div>
						<h3 className="text-sm font-medium mb-3">
							<Trans>Runtime metrics</Trans>
						</h3>
						<div className="border rounded-md">
							<table className="w-full text-sm">
								<tbody>
									{renderRow("mainPid", t`Main PID`, mainPidValue, true)}
									{renderRow("execMainPid", t`Exec main PID`, execMainPidValue)}
									{renderRow("tasks", t`Tasks`, tasks, true)}
									{renderRow("cpuTime", t`CPU time`, cpuTime)}
									{renderRow("memory", t`Memory`, memoryCurrent, true)}
									{renderRow("memoryPeak", t`Memory peak`, memoryPeak)}
									{renderRow("memoryLimit", t`Memory limit`, memoryLimit)}
									{renderRow("restarts", t`Restarts`, restartsValue, true)}
								</tbody>
							</table>
						</div>
					</div>

					<div className="hidden has-[tr]:block">
						<h3 className="text-sm font-medium mb-3">
							<Trans>Relationships</Trans>
						</h3>
						<div className="border rounded-md">
							<table className="w-full text-sm">
								<tbody>
									{renderRow(
										"wants",
										t`Wants`,
										Array.isArray(details?.Wants) && details.Wants.length > 0 ? details.Wants.join(", ") : undefined
									)}
									{renderRow(
										"requires",
										t`Requires`,
										Array.isArray(details?.Requires) && details.Requires.length > 0
											? details.Requires.join(", ")
											: undefined
									)}
									{renderRow(
										"requiredBy",
										t`Required by`,
										Array.isArray(details?.RequiredBy) && details.RequiredBy.length > 0
											? details.RequiredBy.join(", ")
											: undefined
									)}
									{renderRow(
										"conflicts",
										t`Conflicts`,
										Array.isArray(details?.Conflicts) && details.Conflicts.length > 0
											? details.Conflicts.join(", ")
											: undefined
									)}
									{renderRow(
										"before",
										t`Before`,
										Array.isArray(details?.Before) && details.Before.length > 0 ? details.Before.join(", ") : undefined
									)}
									{renderRow(
										"after",
										t`After`,
										Array.isArray(details?.After) && details.After.length > 0 ? details.After.join(", ") : undefined
									)}
									{renderRow(
										"triggers",
										t`Triggers`,
										Array.isArray(details?.Triggers) && details.Triggers.length > 0
											? details.Triggers.join(", ")
											: undefined
									)}
									{renderRow(
										"triggeredBy",
										t`Triggered by`,
										Array.isArray(details?.TriggeredBy) && details.TriggeredBy.length > 0
											? details.TriggeredBy.join(", ")
											: undefined
									)}
								</tbody>
							</table>
						</div>
					</div>

					<div className="hidden has-[tr]:block">
						<h3 className="text-sm font-medium mb-3">
							<Trans>Lifecycle</Trans>
						</h3>
						<div className="border rounded-md">
							<table className="w-full text-sm">
								<tbody>
									{renderRow("activeSince", t`Became active`, activeEnterTimestamp)}
									{service.state !== ServiceStatus.Active &&
										renderRow("lastActive", t`Exited active`, activeExitTimestamp)}
									{renderRow("inactiveSince", t`Became inactive`, inactiveEnterTimestamp)}
									{renderRow("execMainStart", t`Process started`, execMainStartTimestamp)}
									{/* {renderRow("invocationId", t`Invocation ID`, details?.InvocationID)} */}
									{/* {renderRow("freezerState", t`Freezer state`, details?.FreezerState)} */}
								</tbody>
							</table>
						</div>
					</div>

					<div className="hidden has-[tr]:block">
						<h3 className="text-sm font-medium mb-3">
							<Trans>Capabilities</Trans>
						</h3>
						<div className="border rounded-md">
							<table className="w-full text-sm">
								<tbody>
									{renderRow("canStart", t`Can start`, details?.CanStart ? t`Yes` : t`No`)}
									{renderRow("canStop", t`Can stop`, details?.CanStop ? t`Yes` : t`No`)}
									{renderRow("canReload", t`Can reload`, details?.CanReload ? t`Yes` : t`No`)}
									{/* {renderRow("refuseManualStart", t`Refuse manual start`, details?.RefuseManualStart ? t`Yes` : t`No`)}
									{renderRow("refuseManualStop", t`Refuse manual stop`, details?.RefuseManualStop ? t`Yes` : t`No`)} */}
								</tbody>
							</table>
						</div>
					</div>
				</div>
			</SheetContent>
		</Sheet>
	)
}

function SystemdTableHead({ table }: { table: TableType<SystemdRecord> }) {
	return (
		<TableHeader className="sticky top-0 z-50 w-full border-b-2">
			{table.getHeaderGroups().map((headerGroup) => (
				<tr key={headerGroup.id}>
					{headerGroup.headers.map((header) => {
						return (
							<TableHead className="px-2" key={header.id}>
								{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
							</TableHead>
						)
					})}
				</tr>
			))}
		</TableHeader>
	)
}

const SystemdTableRow = memo(function SystemdTableRow({
	row,
	virtualRow,
	openSheet,
}: {
	row: Row<SystemdRecord>
	virtualRow: VirtualItem
	openSheet: (service: SystemdRecord) => void
}) {
	return (
		<TableRow
			data-state={row.getIsSelected() && "selected"}
			className="cursor-pointer transition-opacity"
			onClick={() => openSheet(row.original)}
		>
			{row.getVisibleCells().map((cell) => (
				<TableCell
					key={cell.id}
					className="py-0"
					style={{
						height: virtualRow.size,
					}}
				>
					{flexRender(cell.column.columnDef.cell, cell.getContext())}
				</TableCell>
			))}
		</TableRow>
	)
})
