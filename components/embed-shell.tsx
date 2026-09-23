"use client";

import { useEffect } from "react";
import { BookingWidget } from "@/components/booking-widget";

export function EmbedShell() {
  useEffect(() => {
    document.body.classList.add("weekline-embed");
    const send = () => {
      const height = Math.ceil(document.documentElement.scrollHeight);
      window.parent.postMessage({ source: "weekline", height }, "*");
    };
    send();
    const observer = new ResizeObserver(send);
    observer.observe(document.body);
    return () => {
      document.body.classList.remove("weekline-embed");
      observer.disconnect();
    };
  }, []);

  return <BookingWidget />;
}
