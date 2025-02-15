import {
  createRouter as _createRouter,
  toRouteMatcher,
  RouteMatcher,
} from "radix3";
import type { HTTPMethod, EventHandler } from "./types";
import { createError } from "./error";
import { eventHandler, toEventHandler } from "./event";

export type RouterMethod = Lowercase<HTTPMethod>;
const RouterMethods: RouterMethod[] = [
  "connect",
  "delete",
  "get",
  "head",
  "options",
  "post",
  "put",
  "trace",
  "patch",
];

export type RouterUse = (
  path: string,
  handler: EventHandler,
  method?: RouterMethod | RouterMethod[],
) => Router;
export type AddRouteShortcuts = Record<RouterMethod, RouterUse>;

export interface Router extends AddRouteShortcuts {
  add: RouterUse;
  use: RouterUse;
  handler: EventHandler;
}

export interface RouteNode {
  handlers: Partial<Record<RouterMethod | "all", EventHandler>>;
  path: string;
}

export interface CreateRouterOptions {
  /** @deprecated Please use `preemptive` instead. **/
  preemtive?: boolean;
  // 中文：抢占式路由
  preemptive?: boolean;
}

/**
 * 创建路由，比较灵活
 * 
 */
export function createRouter(opts: CreateRouterOptions = {}): Router {
  // * 核心依赖 radix3 创建路由匹配器
  const _router = _createRouter<RouteNode>({});
  const routes: Record<string, RouteNode> = {};

  let _matcher: RouteMatcher | undefined;

  const router: Router = {} as Router;

  // Utilities to add a new route
  const addRoute = (
    path: string,
    handler: EventHandler,
    method: RouterMethod | RouterMethod[] | "all",
  ) => {
    let route = routes[path];
    if (!route) {
      routes[path] = route = { path, handlers: {} };
      // *
      _router.insert(path, route);
    }
    if (Array.isArray(method)) {
      for (const m of method) {
        addRoute(path, handler, m);
      }
    } else {
      // *
      route.handlers[method] = toEventHandler(handler, undefined, path);
    }
    return router;
  };

  router.use = router.add = (path, handler, method) =>
    addRoute(path, handler as EventHandler, method || "all");
  // * 支持get post ...
  for (const method of RouterMethods) {
    router[method] = (path, handle) => router.add(path, handle, method);
  }

  // Main handle
  router.handler = eventHandler((event) => {
    // Remove query parameters for matching
    let path = event.path || "/";
    const qIndex = path.indexOf("?");
    if (qIndex !== -1) {
      path = path.slice(0, Math.max(0, qIndex));
    }

    // Match route
    // * 匹配路由
    const matched = _router.lookup(path);
    if (!matched || !matched.handlers) {
      if (opts.preemptive || opts.preemtive) {
        throw createError({
          statusCode: 404,
          name: "Not Found",
          statusMessage: `Cannot find any route matching ${event.path || "/"}.`,
        });
      } else {
        return; // Let app match other handlers
      }
    }

    // Match method
    const method = (
      event.node.req.method || "get"
    ).toLowerCase() as RouterMethod;

    let handler: EventHandler | undefined =
      matched.handlers[method] || matched.handlers.all;

    // Fallback to search for shadowed routes
    // 回退以搜索被遮蔽的路线
    if (!handler) {
      if (!_matcher) {
        _matcher = toRouteMatcher(_router);
      }
      // Default order is less specific to most specific
      const _matches = _matcher.matchAll(path).reverse() as RouteNode[];
      for (const _match of _matches) {
        if (_match.handlers[method]) {
          handler = _match.handlers[method];
          matched.handlers[method] = matched.handlers[method] || handler;
          break;
        }
        if (_match.handlers.all) {
          handler = _match.handlers.all;
          matched.handlers.all = matched.handlers.all || handler;
          break;
        }
      }
    }

    // Method not matched
    if (!handler) {
      if (opts.preemptive || opts.preemtive) {
        throw createError({
          statusCode: 405,
          name: "Method Not Allowed",
          statusMessage: `Method ${method} is not allowed on this route.`,
        });
      } else {
        return; // Let app match other handlers
      }
    }

    // Add matched route and params to the context
    event.context.matchedRoute = matched;
    const params = matched.params || {};
    event.context.params = params;

    // Call handler
    // * 执行匹配的理由
    return Promise.resolve(handler(event)).then((res) => {
      if (res === undefined && (opts.preemptive || opts.preemtive)) {
        return null; // Send empty content
      }
      // *
      return res;
    });
  });

  return router;
}
