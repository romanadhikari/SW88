import { ShieldCheck, X } from 'lucide-react';

export function LegalModal({
  open,
  onClose,
  initialTab = 'terms',
}: {
  open: boolean;
  onClose: () => void;
  initialTab?: 'terms' | 'privacy' | 'responsible';
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[85dvh] flex flex-col rounded-2xl bg-[#14171F] border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-[#E6B84F]" />
            <h3 className="text-lg font-bold text-[#F5F7FA]">SW88 Compliance & Platform Policies</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-[#9CA3AF] hover:text-white hover:bg-white/5 cursor-pointer"
            aria-label="Close legal policy modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6 text-sm text-[#D1D5DB] leading-relaxed">
          <section className={initialTab === 'terms' ? 'ring-1 ring-[#E6B84F]/30 rounded-xl p-4 bg-white/[0.02]' : ''}>
            <h4 className="font-bold text-[#F5F7FA] text-base mb-2">1. Terms & Conditions</h4>
            <ul className="list-disc pl-5 space-y-1.5 text-[#9CA3AF]">
              <li>Participation on SW88 is strictly restricted to individuals aged 18 years or older.</li>
              <li>Each account is assigned a unique 6-character User ID (UID) that cannot be transferred or forged.</li>
              <li>Deposits require valid payment verification; fraudulent screenshots or duplicate claims result in permanent account ban.</li>
              <li>Only verified game winnings are eligible for withdrawal (minimum NPR 1,000, maximum NPR 10,000 per request).</li>
              <li>All peer-to-peer Agent Transfers (0% commission, min NPR 1,500 balance retained) and Friend Transfers (10% commission paid by sender) are irreversible once confirmed.</li>
            </ul>
          </section>

          <section className={initialTab === 'privacy' ? 'ring-1 ring-[#E6B84F]/30 rounded-xl p-4 bg-white/[0.02]' : ''}>
            <h4 className="font-bold text-[#F5F7FA] text-base mb-2">2. Privacy & Screenshot Retention Policy</h4>
            <ul className="list-disc pl-5 space-y-1.5 text-[#9CA3AF]">
              <li>All financial records, ledger transactions, and account credentials are stored securely with cryptographic password hashing.</li>
              <li>Uploaded deposit payment screenshots are accessible only to authorized SW88 administrators for verification.</li>
              <li>To protect user privacy, reviewed deposit screenshots are automatically and permanently deleted 5 minutes after approval or rejection.</li>
            </ul>
          </section>

          <section className={initialTab === 'responsible' ? 'ring-1 ring-[#E6B84F]/30 rounded-xl p-4 bg-white/[0.02]' : ''}>
            <h4 className="font-bold text-[#F5F7FA] text-base mb-2">3. Responsible Gaming & Self-Exclusion</h4>
            <ul className="list-disc pl-5 space-y-1.5 text-[#9CA3AF]">
              <li>SW88 enforces fair, transparent server-side randomness across all integrated games without per-user outcome manipulation.</li>
              <li>Users can configure a custom daily spending limit (NPR) or activate a temporary self-exclusion period anytime in their Profile settings.</li>
              <li>Never play with funds you cannot afford to lose. Play responsibly.</li>
            </ul>
          </section>
        </div>

        <div className="px-6 py-4 border-t border-white/10 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-6 rounded-xl bg-[#E6B84F] text-[#0B0D11] font-bold text-sm hover:brightness-105 cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
