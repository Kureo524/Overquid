import { useEffect, useState } from 'react';

const format = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Demo content: something worth pinning. Ticks only while visible. */
export function Clock({ running }: { running: boolean }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!running) return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  return <p className="big-number">{format.format(now)}</p>;
}
