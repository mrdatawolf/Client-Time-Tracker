import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/ThemeProvider';
import { SelectedClientProvider } from '@/components/SelectedClientProvider';

export const metadata: Metadata = {
  title: 'Client Time Tracker',
  description: 'Track time spent for IT clients',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          <SelectedClientProvider>
            {children}
          </SelectedClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
