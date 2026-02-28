"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./page.module.css";

const SPLASH_IMAGES = [
  { src: "/login-hero.jpg", position: "center 25%" },
  { src: "/splash-2.jpg", position: "center 35%" },
] as const;

export default function SplashPage() {
  const router = useRouter();
  const [current, setCurrent] = useState(0);
  const [next, setNext] = useState<number | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTransition = (toIndex: number) => {
    if (transitioning || toIndex === current) return;
    setNext(toIndex);
    setTransitioning(true);
    setTimeout(() => {
      setCurrent(toIndex);
      setNext(null);
      setTransitioning(false);
    }, 1200);
  };

  useEffect(() => {
    if (SPLASH_IMAGES.length <= 1) return;
    timerRef.current = setInterval(() => {
      if (!transitioning) {
        const nextIdx = (current + 1) % SPLASH_IMAGES.length;
        startTransition(nextIdx);
      }
    }, 5500);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [current, transitioning]);

  const goTo = (index: number) => {
    if (timerRef.current) clearInterval(timerRef.current);
    startTransition(index);
  };

  return (
    <main className={styles.splash}>
      <Image
        src={SPLASH_IMAGES[current].src}
        alt="Old Oak Horses splash"
        fill
        priority
        sizes="100vw"
        className={styles.splashImageCurrent}
        style={{
          objectPosition: SPLASH_IMAGES[current].position,
          opacity: next !== null ? 0 : 1,
        }}
      />

      {next !== null ? (
        <Image
          src={SPLASH_IMAGES[next].src}
          alt="Old Oak Horses splash next"
          fill
          sizes="100vw"
          className={styles.splashImageNext}
          style={{ objectPosition: SPLASH_IMAGES[next].position }}
        />
      ) : null}

      <div className={styles.splashOverlay} />

      <div className={styles.splashContent}>
        <h1 className={styles.splashTitle}>old oak horses</h1>
        <button type="button" className={styles.splashEnter} onClick={() => router.push("/login")}>
          enter
        </button>
      </div>

      {SPLASH_IMAGES.length > 1 ? (
        <div className={styles.splashDots}>
          {SPLASH_IMAGES.map((_, index) => {
            const isActive = index === current && next === null;
            return (
              <button
                key={`dot-${index}`}
                type="button"
                aria-label={`Go to splash image ${index + 1}`}
                className={`${styles.splashDot} ${isActive ? styles.splashDotActive : styles.splashDotInactive}`}
                onClick={() => goTo(index)}
              />
            );
          })}
        </div>
      ) : null}
    </main>
  );
}
