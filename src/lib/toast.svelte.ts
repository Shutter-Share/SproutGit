export type ToastType = "info" | "success" | "error" | "warning";

export type Toast = {
  id: number;
  type: ToastType;
  message: string;
  removing?: boolean;
};

let nextId = 0;
let toasts = $state<Toast[]>([]);

export function getToasts(): Toast[] {
  return toasts;
}

export function addToast(type: ToastType, message: string, durationMs = 4000) {
  const id = nextId++;
  toasts = [...toasts, { id, type, message }];

  if (durationMs > 0) {
    setTimeout(() => removeToast(id), durationMs);
  }

  return id;
}

export function removeToast(id: number) {
  const idx = toasts.findIndex((t) => t.id === id);
  if (idx === -1) return;

  // Mark as removing for exit animation
  toasts = toasts.map((t) => (t.id === id ? { ...t, removing: true } : t));
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
  }, 200);
}

export const toast = {
  info: (msg: string, duration?: number) => addToast("info", msg, duration),
  success: (msg: string, duration?: number) => addToast("success", msg, duration),
  error: (msg: string, duration?: number) => addToast("error", msg, duration),
  warning: (msg: string, duration?: number) => addToast("warning", msg, duration),
};
