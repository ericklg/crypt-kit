import '@crypt-kit/board/board.css';
import './app.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Exorcist',
  description: 'Stale GitHub issues and pull requests, each with a drafted triage comment for you to banish or spare.',
};

export const viewport: Viewport = { themeColor: '#0b0e14', colorScheme: 'dark' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
