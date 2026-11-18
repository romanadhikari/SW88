export function BrandMark({ subtitle }: { subtitle?: string }) {
  return (
    <div className="inline-flex items-center gap-2.5 select-none">
      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#F7D774] via-[#E6B84F] to-[#B8860B] p-[1.5px] shadow-[0_0_20px_rgba(230,184,79,0.25)] shrink-0">
        <div className="w-full h-full rounded-[10px] bg-[#0B0D11] flex items-center justify-center">
          <svg viewBox="0 0 32 32" className="w-5 h-5" fill="none" aria-hidden="true">
            <path
              d="M16 3L27 7.5V15.5C27 22.1 22.3 27.6 16 29.5C9.7 27.6 5 22.1 5 15.5V7.5L16 3Z"
              stroke="#E6B84F"
              strokeWidth="2"
              fill="rgba(230,184,79,0.12)"
            />
            <path
              d="M10.5 19.5L12.3 12L16 15.8L19.7 12L21.5 19.5H10.5Z"
              fill="#E6B84F"
            />
          </svg>
        </div>
      </div>
      <div className="leading-none">
        <div className="font-display font-extrabold text-lg tracking-tight text-[#F5F7FA]">
          SW<span className="text-[#E6B84F]">88</span>
        </div>
        {subtitle && (
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9CA3AF] mt-0.5">
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
