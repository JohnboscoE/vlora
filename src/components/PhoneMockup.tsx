import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A 3D phone frame for the landing demo: titanium-style rail, Dynamic Island, side
 * buttons and a status bar, tilted in CSS 3D with a visible edge, screen glare and a
 * floor shadow. It straightens when hovered or focused, and holds still for anyone
 * who prefers reduced motion. Pure CSS, no images.
 * Turn it off with SHOW_PHONE_MOCKUP in Landing.tsx.
 */
export function PhoneMockup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('vlora-phone-scene w-[268px] shrink-0 sm:w-[310px]', className)}>
      <div className="vlora-phone relative">
        {/* Thickness: a slab behind the body, pushed back in 3D */}
        <div className="vlora-phone-edge absolute inset-0 rounded-[2.8rem] bg-gradient-to-b from-[#2b2f38] via-[#14171d] to-[#2b2f38]" />

        {/* Side buttons */}
        <span className="absolute -left-[3px] top-[104px] h-7 w-[3px] rounded-l-sm bg-gradient-to-b from-[#6c7280] to-[#3b4049]" />
        <span className="absolute -left-[3px] top-[150px] h-12 w-[3px] rounded-l-sm bg-gradient-to-b from-[#6c7280] to-[#3b4049]" />
        <span className="absolute -left-[3px] top-[212px] h-12 w-[3px] rounded-l-sm bg-gradient-to-b from-[#6c7280] to-[#3b4049]" />
        <span className="absolute -right-[3px] top-[176px] h-16 w-[3px] rounded-r-sm bg-gradient-to-b from-[#6c7280] to-[#3b4049]" />

        {/* Titanium rail → glass back → screen */}
        <div className="relative rounded-[2.8rem] bg-gradient-to-br from-[#9aa0ab] via-[#4b515c] to-[#8d939e] p-[2px] shadow-[0_40px_90px_rgba(5,11,26,0.6)]">
          <div className="rounded-[2.7rem] bg-[#070c18] p-[9px]">
            <div className="relative aspect-[9/19.5] overflow-hidden rounded-[2.2rem] bg-gradient-to-b from-[#0d1a3a] via-[#091124] to-[#050b1a]">
              {/* Dynamic Island */}
              <div className="absolute left-1/2 top-2 z-20 h-[24px] w-[84px] -translate-x-1/2 rounded-full bg-black">
                <span className="absolute right-3 top-1/2 size-2 -translate-y-1/2 rounded-full bg-[#10182b]" />
              </div>

              {/* Status bar */}
              <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-5 pt-[9px] text-[10px] font-semibold text-white/85">
                <span>9:41</span>
                <span className="flex items-center gap-[3px]" aria-hidden="true">
                  {[3, 5, 7, 9].map((h) => (
                    <span key={h} className="w-[2.5px] rounded-sm bg-white/85" style={{ height: h }} />
                  ))}
                  <span className="ml-1 flex h-[10px] w-[18px] items-center rounded-[3px] border border-white/70 p-[1.5px]">
                    <span className="h-full w-2/3 rounded-[1px] bg-white/85" />
                  </span>
                </span>
              </div>

              {/* Screen content */}
              <div className="flex h-full flex-col justify-center px-3 pb-8 pt-12">{children}</div>

              {/* Glass glare across the screen */}
              <span
                className="pointer-events-none absolute inset-0 z-30 bg-gradient-to-br from-white/14 via-transparent to-transparent"
                aria-hidden="true"
              />

              {/* Home indicator */}
              <span className="absolute bottom-[7px] left-1/2 z-30 h-[4px] w-[100px] -translate-x-1/2 rounded-full bg-white/65" />
            </div>
          </div>
        </div>

        {/* Floor shadow, flattened under the device */}
        <span className="vlora-phone-shadow" aria-hidden="true" />
      </div>
    </div>
  );
}
