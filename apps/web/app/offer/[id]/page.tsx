import Link from "next/link";
import { notFound } from "next/navigation";
import { PayPanel } from "@/components/pay-panel";
import { demoAccount, serverConfig } from "@/lib/config";
import { getOffer, getTokenMeta, previewSplit } from "@/lib/near/server";

export const dynamic = "force-dynamic";

export default async function OfferPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const { id } = await params;
  const { ref } = await searchParams;
  const offerId = Number(id);
  if (!Number.isInteger(offerId) || offerId < 1) notFound();

  const config = serverConfig();
  const [offer, tokenMeta] = await Promise.all([getOffer(offerId), getTokenMeta()]);
  if (!offer) notFound();

  const refCode = typeof ref === "string" ? ref.slice(0, 32) : "";
  const preview = await previewSplit(offerId, offer.price, refCode || null);

  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <p className="eyebrow">Offer #{offer.id}</p>
          <h1>{offer.title}</h1>
          <p className="lead">{offer.description || "No description provided."}</p>
        </div>
        <Link className="btn btn-ghost btn-sm" href="/business">
          Business console
        </Link>
      </div>

      <PayPanel
        offer={offer}
        preview={preview}
        initialRef={refCode}
        decimals={tokenMeta?.decimals ?? config.tokenDecimals}
        symbol={tokenMeta?.symbol ?? config.tokenSymbol}
        contractId={config.contractId}
        ftAccount={config.ftAccount}
        treasury={config.treasuryAccount}
        demoMode={config.demoMode}
        demoBuyer={demoAccount("buyer")?.account ?? null}
      />

      <section className="card">
        <h3>How this settles</h3>
        <ol className="list">
          <li>
            Your payment goes into the contract with <code>ft_transfer_call</code> and is attributed to the referral
            code in the link.
          </li>
          <li>
            The merchant may refund while the sale is pending (until{" "}
            {offer.refund_hold_ns === 0 ? "immediately, i.e. release can happen at once" : "the refund hold ends"}).
          </li>
          <li>
            After the hold, <code>release</code> pays the merchant, the creator and the protocol fee in one call. Anyone
            can trigger it; the app&apos;s relayer does it for you.
          </li>
        </ol>
      </section>
    </div>
  );
}
