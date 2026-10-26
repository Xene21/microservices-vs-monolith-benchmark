import { useEffect, useState } from 'react';

// The only place the frontend knows which backend it is talking to.
export const BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
export const BACKEND_NAME = BASE.endsWith(':3000') ? 'Monolith' : 'Microservices';

export async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

// Loads a GET endpoint and gives back data, error and a reload function.
export function useApi(path, token) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    setError('');
    api('GET', path, { token })
      .then((d) => active && setData(d))
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [path, token, tick]);

  return { data, error, reload: () => setTick((t) => t + 1) };
}

export const naira = (n) => `₦${Number(n).toLocaleString('en-NG')}`;
