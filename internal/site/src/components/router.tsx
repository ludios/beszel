// Model-output: Claude Opus 5
import { createRouter } from "@nanostores/router"

const routes = {
	home: "/",
	containers: "/containers",
	smart: "/smart",
	monitors: "/monitors",
	system: `/system/:id`,
	settings: `/settings/:name?`,
	forgot_password: `/forgot-password`,
	request_otp: `/request-otp`,
} as const

/**
 * The base path of the application.
 * This is used to prepend the base path to all routes.
 */
export const basePath = globalThis.BESZEL?.BASE_PATH || ""

/**
 * Prepends the base path to the given path.
 * @param path The path to prepend the base path to.
 * @returns The path with the base path prepended.
 */
export const prependBasePath = (path: string) => (basePath + path).replaceAll("//", "/")

// prepend base path to routes
for (const route in routes) {
	// @ts-expect-error need as const above to get nanostores to parse types properly
	routes[route] = prependBasePath(routes[route])
}

export const $router = createRouter(routes, { links: false })

/** Navigate to url using router
 *  Base path is automatically prepended if serving from subpath
 */
export const navigate = (urlString: string) => {
	const previous_path = location.pathname
	$router.open(urlString)
	// pages scroll the window, so a new route would otherwise open at the offset left by the
	// previous one. back / forward go through popstate instead, where the browser restores
	// the position it saved.
	if (location.pathname !== previous_path) {
		window.scrollTo(0, 0)
	}
}

export function Link(props: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
	return (
		<a
			{...props}
			onClick={(e) => {
				e.preventDefault()
				const href = props.href || ""
				if (e.ctrlKey || e.metaKey) {
					window.open(href, "_blank")
				} else {
					navigate(href)
					props.onClick?.(e)
				}
			}}
		></a>
	)
}
