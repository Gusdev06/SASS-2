export default function DashboardLoading() {
  return (
    <div className="space-y-10 animate-pulse" aria-busy="true" aria-label="Loading">
      {/* header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 pb-6 border-b border-white/10">
        <div className="space-y-3">
          <div className="h-3 w-24 rounded bg-white/10" />
          <div className="h-12 w-64 rounded-lg bg-white/10" />
          <div className="h-4 w-40 rounded bg-white/5" />
        </div>
        <div className="h-10 w-32 rounded-full bg-white/10" />
      </div>

      {/* stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card space-y-3">
            <div className="h-2.5 w-16 rounded bg-white/10" />
            <div className="h-7 w-12 rounded bg-white/10" />
          </div>
        ))}
      </div>

      {/* content block */}
      <div className="space-y-5">
        <div className="h-7 w-48 rounded-lg bg-white/10" />
        <div className="h-40 w-full rounded-xl bg-white/5 border border-white/10" />
      </div>

      {/* grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="aspect-square rounded-xl bg-white/5 border border-white/10" />
        ))}
      </div>
    </div>
  );
}
