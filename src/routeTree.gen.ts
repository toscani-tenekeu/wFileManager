/* eslint-disable */
// @ts-nocheck
// This file is generated from the current file routes.

import { Route as rootRouteImport } from './routes/__root'
import { Route as AppRouteImport } from './routes/_app'
import { Route as ForgotPasswordRouteImport } from './routes/forgot-password'
import { Route as LockedRouteImport } from './routes/locked'
import { Route as LoginRouteImport } from './routes/login'
import { Route as ResetPasswordRouteImport } from './routes/reset-password'
import { Route as SessionExpiredRouteImport } from './routes/session-expired'
import { Route as SetupRouteImport } from './routes/setup'
import { Route as SitemapDotxmlRouteImport } from './routes/sitemap[.]xml'
import { Route as ApiHealthRouteImport } from './routes/api.health'
import { Route as ApiLocalRouteImport } from './routes/api.local'
import { Route as ApiSqliteRouteImport } from './routes/api.sqlite'
import { Route as AppIndexRouteImport } from './routes/_app.index'
import { Route as AppAboutRouteImport } from './routes/_app.about'
import { Route as AppAccountRouteImport } from './routes/_app.account'
import { Route as AppDocsRouteImport } from './routes/_app.docs'
import { Route as AppExplorerRouteImport } from './routes/_app.explorer'
import { Route as AppNotificationsRouteImport } from './routes/_app.notifications'
import { Route as AppRolesRouteImport } from './routes/_app.roles'
import { Route as AppTerminalRouteImport } from './routes/_app.terminal'
import { Route as AppTrashRouteImport } from './routes/_app.trash'
import { Route as AppUploadsRouteImport } from './routes/_app.uploads'
import { Route as AppUsersRouteImport } from './routes/_app.users'

const AppRoute = AppRouteImport.update({ id: '/_app', getParentRoute: () => rootRouteImport } as any)
const ForgotPasswordRoute = ForgotPasswordRouteImport.update({ id: '/forgot-password', path: '/forgot-password', getParentRoute: () => rootRouteImport } as any)
const LockedRoute = LockedRouteImport.update({ id: '/locked', path: '/locked', getParentRoute: () => rootRouteImport } as any)
const LoginRoute = LoginRouteImport.update({ id: '/login', path: '/login', getParentRoute: () => rootRouteImport } as any)
const ResetPasswordRoute = ResetPasswordRouteImport.update({ id: '/reset-password', path: '/reset-password', getParentRoute: () => rootRouteImport } as any)
const SessionExpiredRoute = SessionExpiredRouteImport.update({ id: '/session-expired', path: '/session-expired', getParentRoute: () => rootRouteImport } as any)
const SetupRoute = SetupRouteImport.update({ id: '/setup', path: '/setup', getParentRoute: () => rootRouteImport } as any)
const SitemapDotxmlRoute = SitemapDotxmlRouteImport.update({ id: '/sitemap.xml', path: '/sitemap.xml', getParentRoute: () => rootRouteImport } as any)
const ApiHealthRoute = ApiHealthRouteImport.update({ id: '/api/health', path: '/api/health', getParentRoute: () => rootRouteImport } as any)
const ApiLocalRoute = ApiLocalRouteImport.update({ id: '/api/local', path: '/api/local', getParentRoute: () => rootRouteImport } as any)
const ApiSqliteRoute = ApiSqliteRouteImport.update({ id: '/api/sqlite', path: '/api/sqlite', getParentRoute: () => rootRouteImport } as any)

const AppIndexRoute = AppIndexRouteImport.update({ id: '/', path: '/', getParentRoute: () => AppRoute } as any)
const AppAboutRoute = AppAboutRouteImport.update({ id: '/about', path: '/about', getParentRoute: () => AppRoute } as any)
const AppAccountRoute = AppAccountRouteImport.update({ id: '/account', path: '/account', getParentRoute: () => AppRoute } as any)
const AppDocsRoute = AppDocsRouteImport.update({ id: '/docs', path: '/docs', getParentRoute: () => AppRoute } as any)
const AppExplorerRoute = AppExplorerRouteImport.update({ id: '/explorer', path: '/explorer', getParentRoute: () => AppRoute } as any)
const AppNotificationsRoute = AppNotificationsRouteImport.update({ id: '/notifications', path: '/notifications', getParentRoute: () => AppRoute } as any)
const AppRolesRoute = AppRolesRouteImport.update({ id: '/roles', path: '/roles', getParentRoute: () => AppRoute } as any)
const AppTerminalRoute = AppTerminalRouteImport.update({ id: '/terminal', path: '/terminal', getParentRoute: () => AppRoute } as any)
const AppTrashRoute = AppTrashRouteImport.update({ id: '/trash', path: '/trash', getParentRoute: () => AppRoute } as any)
const AppUploadsRoute = AppUploadsRouteImport.update({ id: '/uploads', path: '/uploads', getParentRoute: () => AppRoute } as any)
const AppUsersRoute = AppUsersRouteImport.update({ id: '/users', path: '/users', getParentRoute: () => AppRoute } as any)

const AppRouteChildren = {
  AppAboutRoute,
  AppAccountRoute,
  AppDocsRoute,
  AppExplorerRoute,
  AppNotificationsRoute,
  AppRolesRoute,
  AppTerminalRoute,
  AppTrashRoute,
  AppUploadsRoute,
  AppUsersRoute,
  AppIndexRoute,
}

const AppRouteWithChildren = AppRoute._addFileChildren(AppRouteChildren)

const rootRouteChildren = {
  AppRoute: AppRouteWithChildren,
  ForgotPasswordRoute,
  LockedRoute,
  LoginRoute,
  ResetPasswordRoute,
  SessionExpiredRoute,
  SetupRoute,
  SitemapDotxmlRoute,
  ApiHealthRoute,
  ApiLocalRoute,
  ApiSqliteRoute,
}

export const routeTree = rootRouteImport
  ._addFileChildren(rootRouteChildren)

// Broad route declarations keep file-route calls typed while the router plugin
// regenerates the detailed declarations during the next build.
declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/_app': any
    '/forgot-password': any
    '/locked': any
    '/login': any
    '/reset-password': any
    '/session-expired': any
    '/setup': any
    '/sitemap.xml': any
    '/api/health': any
    '/api/local': any
    '/api/sqlite': any
    '/_app/': any
    '/_app/about': any
    '/_app/account': any
    '/_app/docs': any
    '/_app/explorer': any
    '/_app/notifications': any
    '/_app/roles': any
    '/_app/terminal': any
    '/_app/trash': any
    '/_app/uploads': any
    '/_app/users': any
  }
}
