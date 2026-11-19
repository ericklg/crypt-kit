import '@crypt-kit/board/board.css';
import './app.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Price Poltergeist',
  description: 'PC games on your watchlist that dropped under your target price, each with a buy-or-wait verdict. Prices from CheapShark.',
};

export const viewport: Viewport = { themeColor: '#120b10', colorScheme: 'dark' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
