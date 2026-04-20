export function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-6 animate-pulse">
      <div className="grid grid-cols-1 md:grid-cols-[1.3fr_1fr] gap-4">
        <div className="aspect-[4/3] md:min-h-[360px] rounded-2xl bg-[color:var(--color-surface)] hairline" />
        <div className="flex flex-col gap-2">
          <div className="h-10 rounded-lg bg-[color:var(--color-surface)] hairline" />
          <div className="h-10 rounded-lg bg-[color:var(--color-surface)] hairline" />
          <div className="h-10 rounded-lg bg-[color:var(--color-surface)] hairline" />
          <div className="h-28 rounded-lg bg-[color:var(--color-surface)] hairline mt-3" />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-[120px] rounded-xl bg-[color:var(--color-surface)] hairline"
          />
        ))}
      </div>
    </div>
  );
}
