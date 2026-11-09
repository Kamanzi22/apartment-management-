import type { Metadata } from 'next'
import { Inter, Instrument_Serif } from 'next/font/google'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'
import { SWRegister } from '@/components/sw-register'

const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-inter' })
const instrument = Instrument_Serif({ subsets: ['latin'], weight: '400', style: 'italic', variable: '--font-instrument' })

export const metadata: Metadata = {
  title: 'Apartment Manager',
  description: 'Property management for your 4-unit building',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'AptManager',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${instrument.variable} h-full`}>
      <head>
        <meta name="theme-color" content="#2F4252" />
        <link rel="apple-touch-icon" href="/icon.svg" />
      </head>
      <body className="app-bg min-h-full font-sans text-[var(--ink)] antialiased">
        {children}
        <Toaster richColors position="top-right" />
        <SWRegister />
      </body>
    </html>
  )
}
