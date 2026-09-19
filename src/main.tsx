import './tracing'
import './console-capture'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConnectKitProvider } from 'connectkit'
import { Toaster } from 'sonner'
import { config } from './config'
import Root from './Root'
import { ThemeProvider, useTheme } from './lib/theme'
import './index.css'

const queryClient = new QueryClient()

// ConnectKit's modal and the toasts follow the app theme
function ThemedShell() {
  const { theme } = useTheme()
  return (
    <ConnectKitProvider mode={theme}>
      <Root />
      <Toaster position="top-center" theme={theme} richColors />
    </ConnectKitProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <ThemedShell />
        </QueryClientProvider>
      </WagmiProvider>
    </ThemeProvider>
  </StrictMode>,
)
