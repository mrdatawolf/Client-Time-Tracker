import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number | string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(num);
}

export function formatDate(date: string | Date): string {
  let d: Date;

  if (typeof date === 'string') {
    // If it's a date-only string (e.g., '2026-02-23'), append time to parse it in the local timezone.
    // If it's a full ISO string with a time component, parse it directly.
    if (date.includes('T')) {
      d = new Date(date);
    } else {
      d = new Date(`${date}T00:00:00`);
    }
  } else {
    d = date;
  }

  if (isNaN(d.getTime())) {
    return 'Invalid Date';
  }

  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatHours(hours: number | string): string {
  const num = typeof hours === 'string' ? parseFloat(hours) : hours;
  return num.toFixed(2);
}

export function getWeekDates(weekStart: Date): Date[] {
  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    dates.push(d);
  }
  return dates;
}

export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
