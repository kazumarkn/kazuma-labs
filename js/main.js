// =============================
// Kazuma Labs – Main UI JS
// =============================

// Pause hero video after scrolling past it (optional but professional)
document.addEventListener("DOMContentLoaded", () => {
  const video = document.querySelector(".hero-bg-video");
  if (!video) return;

  const observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) {
        video.pause();
      } else {
        video.play().catch(() => {});
      }
    },
    { threshold: 0.2 }
  );

  observer.observe(video);
});
