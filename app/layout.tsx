import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Agendaki · Escolha seu horário',
  description: 'Consulte serviços e horários disponíveis para seu próximo atendimento.',
  icons: { icon: '/favicon.svg', apple: '/icones/icone-180.png' },
  appleWebApp: { capable: true, title: 'Agendaki' },
  robots: { index: false, follow: false },
};
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
