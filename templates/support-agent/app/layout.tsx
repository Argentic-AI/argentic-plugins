import type { Metadata, Viewport } from 'next'
import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import './globals.css'

export const metadata: Metadata = {
  title: 'Support agent that survives a kill',
  description: 'A Next.js support agent that sends one email, built on the Vercel AI SDK and Argentic. Kill it mid-run and it resumes without sending twice.',
}
export const viewport: Viewport = { colorScheme: 'light dark' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
