import type { ResumeReview } from "../domain/review";

export function renderReviewCard(review: ResumeReview): string {
  return `<section class="review-card">
    <div class="review-heading"><div><span>内容检查</span><strong>${review.label}</strong></div><div class="review-score"><b>${review.score}</b><small>/ 100</small></div></div>
    <ul>${review.items.slice(0, 3).map((item) => `<li data-level="${item.level}">${item.message}</li>`).join("")}</ul>
  </section>`;
}
