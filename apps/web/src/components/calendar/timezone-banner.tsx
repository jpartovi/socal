"use client";

import { Button } from "@socal/ui/components/button";
import { useEffect, useState } from "react";

import { deviceTimeZone } from "@/components/calendar/lib";

const STORED_TZ_KEY = "socal.timeZone";

export function TimezoneBanner() {
  const [storedTz, setStoredTz] = useState<string | null>(null);
  const [deviceTz, setDeviceTz] = useState<string | null>(null);

  useEffect(() => {
    const dev = deviceTimeZone();
    setDeviceTz(dev);
    const stored = window.localStorage.getItem(STORED_TZ_KEY);
    if (stored === null) {
      window.localStorage.setItem(STORED_TZ_KEY, dev);
      setStoredTz(dev);
    } else {
      setStoredTz(stored);
    }
  }, []);

  if (!storedTz || !deviceTz || storedTz === deviceTz) return null;

  function adopt() {
    if (!deviceTz) return;
    window.localStorage.setItem(STORED_TZ_KEY, deviceTz);
    setStoredTz(deviceTz);
  }

  function keep() {
    if (!deviceTz) return;
    window.localStorage.setItem(STORED_TZ_KEY, deviceTz);
    setStoredTz(deviceTz);
  }

  return (
    <div className="mx-6 mb-2 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <span>
        Your device timezone changed to{" "}
        <span className="font-medium">{deviceTz}</span> (was{" "}
        <span className="font-medium">{storedTz}</span>).
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 rounded-lg border-amber-300 bg-white hover:bg-amber-100"
          onClick={keep}
        >
          Dismiss
        </Button>
        <Button
          size="sm"
          className="h-8 rounded-lg bg-amber-600 text-white hover:bg-amber-700"
          onClick={adopt}
        >
          Use {deviceTz}
        </Button>
      </div>
    </div>
  );
}
