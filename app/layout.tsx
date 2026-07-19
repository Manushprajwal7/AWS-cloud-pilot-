import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Space_Grotesk, Inter, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'

const displayFont = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['500', '600', '700'],
})

const sansFont = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
})

const monoFont = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500', '600'],
})

export const metadata: Metadata = {
  title: 'AWS CloudPilot - AI FinOps Dashboard',
  description: 'AI-driven cloud cost optimization powered by xAI Grok and ReAct loops',
  generator: 'v0.app',
  icons: {
    icon: '/aws-logo.png',
    shortcut: '/aws-logo.png',
    apple: '/aws-logo.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`light ${displayFont.variable} ${sansFont.variable} ${monoFont.variable}`}>
      <body className="antialiased font-sans">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
