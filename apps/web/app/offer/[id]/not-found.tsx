import Link from "next/link";

export default function OfferNotFound() {
  return (
    <div className="empty">
      <h1 className="empty-title">We couldn&apos;t find this offer</h1>
      <p>The link may be mistyped, or the seller may have removed the offer. Ask whoever shared it for a new link.</p>
      <div className="row">
        <Link className="btn" href="/#offers">
          Browse offers
        </Link>
        <Link className="btn btn-ghost" href="/business">
          Publish an offer
        </Link>
      </div>
    </div>
  );
}
