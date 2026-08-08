import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatDate(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatTime(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleTimeString('es-PE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelativeTime(date: string | Date): string {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Ahora';
  if (minutes < 60) return `Hace ${minutes}m`;
  if (hours < 24) return `Hace ${hours}h`;
  if (days < 7) return `Hace ${days}d`;
  return formatDate(date);
}

export function formatCurrency(amount: number): string {
  return `S/ ${amount.toFixed(2)}`;
}

const STATUS_LABELS: Record<string, string> = {
  nuevo: 'Nuevo',
  interesado: 'Interesado',
  esperando_pago: 'Esperando pago',
  inscrito: 'Inscrito',
};

const STATUS_COLORS: Record<string, string> = {
  nuevo: 'bg-gray-100 text-gray-700',
  interesado: 'bg-blue-100 text-blue-700',
  esperando_pago: 'bg-yellow-100 text-yellow-700',
  inscrito: 'bg-green-100 text-green-700',
};

export function getStatusLabel(status: string): string {
  return STATUS_LABELS[status] || status;
}

export function getStatusColor(status: string): string {
  return STATUS_COLORS[status] || 'bg-gray-100 text-gray-700';
}

const SIM_STATUS_LABELS: Record<string, string> = {
  disponible: 'Disponible',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado',
};

const SIM_STATUS_COLORS: Record<string, string> = {
  disponible: 'bg-green-100 text-green-700',
  finalizado: 'bg-gray-100 text-gray-700',
  cancelado: 'bg-red-100 text-red-700',
};

export function getSimStatusLabel(status: string): string {
  return SIM_STATUS_LABELS[status] || status;
}

export function getSimStatusColor(status: string): string {
  return SIM_STATUS_COLORS[status] || 'bg-gray-100 text-gray-700';
}
