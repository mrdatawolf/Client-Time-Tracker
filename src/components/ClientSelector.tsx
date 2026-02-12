'use client';

import { useState, useEffect } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { clients as clientsApi, type Client } from '@/lib/api';

interface ClientSelectorProps {
  value: string;
  onChange: (clientId: string) => void;
  className?: string;
}

export default function ClientSelector({ value, onChange, className }: ClientSelectorProps) {
  const [clientList, setClientList] = useState<Client[]>([]);

  useEffect(() => {
    clientsApi.list().then((data) => {
      setClientList(data.filter((c) => c.isActive));
    });
  }, []);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="Select a client..." />
      </SelectTrigger>
      <SelectContent>
        {clientList.map((client) => (
          <SelectItem key={client.id} value={client.id}>
            {client.name}
          </SelectItem>
        ))}
        {clientList.length === 0 && (
          <div className="px-2 py-4 text-sm text-gray-500 text-center">
            No clients. Add one first.
          </div>
        )}
      </SelectContent>
    </Select>
  );
}
