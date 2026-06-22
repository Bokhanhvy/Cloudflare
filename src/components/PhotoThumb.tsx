import { useEffect, useState } from "react";
import { signedUrl } from "@/lib/photos";

export function PhotoThumb({ path, onClick, className }: { path: string; onClick?: () => void; className?: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let on = true;
    signedUrl(path).then((u) => on && setUrl(u));
    return () => {
      on = false;
    };
  }, [path]);
  if (!url) return <div className={`bg-muted animate-pulse ${className ?? "h-20 w-20 rounded"}`} />;
  return (
    <img
      src={url}
      alt=""
      onClick={onClick}
      className={`object-cover cursor-pointer rounded border ${className ?? "h-20 w-20"}`}
      loading="lazy"
    />
  );
}
