import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import './index.css'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ApiError, createApi } from '@/lib/api'
import { createAuth } from '@/lib/auth'
import { basePath, loadConfig } from '@/lib/config'
import { AppProvider } from '@/lib/session'
import { createAppRouter, PUBLIC_PATHS } from './router'

async function start() {
  const root = createRoot(document.getElementById('root') as HTMLElement)
  try {
    const config = await loadConfig()
    const auth = createAuth(config)
    await auth.completeSignIn()
    const router = createAppRouter()
    const api = createApi(config.apiBase, auth, () => {
      if (PUBLIC_PATHS.test(location.pathname)) return
      const here = location.pathname.slice(basePath().length - 1) + location.search
      router.navigate(
        here && here !== '/' ? `/sign-in?next=${encodeURIComponent(here)}` : '/sign-in',
      )
    })
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 15_000,
          retry: (count, error) =>
            !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
        },
      },
    })
    root.render(
      <StrictMode>
        <ThemeProvider>
          <TooltipProvider>
            <QueryClientProvider client={queryClient}>
              <AppProvider value={{ config, auth, api }}>
                <RouterProvider router={router} />
              </AppProvider>
            </QueryClientProvider>
            <Toaster richColors />
          </TooltipProvider>
        </ThemeProvider>
      </StrictMode>,
    )
  } catch (error) {
    root.render(
      <div className="p-8 text-sm">
        <h1 className="mb-2 text-lg font-semibold">Tala admin couldn't start</h1>
        <p className="text-muted-foreground">
          {error instanceof Error ? error.message : String(error)}
        </p>
      </div>,
    )
  }
}

void start()
