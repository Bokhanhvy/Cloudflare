import { toast } from "sonner";

export async function copy(text: string, label?: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(label ? `${label}: copied` : "Copied");
  } catch {
    toast.error("Copy failed");
  }
}
