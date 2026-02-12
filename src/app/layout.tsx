import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Client Time Tracker',
  description: 'Track time spent for IT clients',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
