'use client';

import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from './ThemeProvider';
import { cn } from '@/lib/utils';

const options = [
  { value: 'dark' as const, icon: Moon, title: 'Dark mode' },
  { value: 'light' as const, icon: Sun, title: 'Light mode' },
  { value: 'system' as const, icon: Monitor, title: 'System default' },
];

export function ThemeToggle({ collapsed }: { collapsed?: boolean }) {
  const { theme, setTheme } = useTheme();

  const activeIndex = options.findIndex((o) => o.value === theme);

  if (collapsed) {
    // When sidebar is collapsed, show a single button that cycles through modes
    const current = options[activeIndex];
    const Icon = current.icon;
    return (
      <button
        onClick={() => {
          const nextIndex = (activeIndex + 1) % options.length;
          setTheme(options[nextIndex].value);
        }}
        className="p-2 rounded hover:bg-gray-700 transition-colors"
        title={current.title}
      >
        <Icon className="w-4 h-4 text-gray-400" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-0.5 relative">
      {/* Sliding pill indicator */}
      <div
        className="absolute top-0.5 bottom-0.5 w-[calc(33.333%-2px)] bg-gray-600 rounded-md transition-transform duration-200 ease-in-out"
        style={{ transform: `translateX(calc(${activeIndex} * 100% + ${activeIndex} * 2px))` }}
      />

      {options.map((option) => {
        const Icon = option.icon;
        const isActive = theme === option.value;
        return (
          <button
            key={option.value}
            onClick={() => setTheme(option.value)}
            className={cn(
              'relative z-10 flex-1 flex items-center justify-center p-1.5 rounded-md transition-colors',
              isActive ? 'text-gray-100' : 'text-gray-500 hover:text-gray-300'
            )}
            title={option.title}
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        );
      })}
    </div>
  );
}
