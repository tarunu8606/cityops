"use client";

import Link from "next/link";
import { motion } from "framer-motion";

const DUSK_FALLBACK =
  "linear-gradient(180deg, #2b1330 0%, #5b2a4a 55%, #120a16 100%)";
const BOTTOM_OVERLAY =
  "linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.35) 45%, rgba(0,0,0,0) 100%)";

export default function LandingPage() {
  return (
    <div className="relative flex h-screen w-full items-end justify-center overflow-hidden p-8 sm:justify-start sm:p-16">
      {/* Photo layer, degrading gracefully to the gradient if the file is
          missing/unloadable — CSS just skips a failed background-image
          layer and paints the one behind it. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(/images/bus-dusk.jpg), ${DUSK_FALLBACK}`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      {/* Bottom-to-top dark gradient so the card text stays legible. */}
      <div className="absolute inset-0" style={{ background: BOTTOM_OVERLAY }} />

      {/* Fade-through-black entrance veil. */}
      <motion.div
        className="pointer-events-none absolute inset-0 z-20 bg-black"
        initial={{ opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      />

      <div className="relative z-10 flex w-full max-w-xl flex-col items-center text-center sm:items-start sm:text-left">
        <motion.h1
          initial={{ opacity: 0, y: 10, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: "easeOut", delay: 0.2 }}
          className="text-4xl font-semibold tracking-tight text-white sm:text-5xl"
        >
          CityOps
        </motion.h1>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut", delay: 0.5 }}
          className="mt-6 w-full rounded-2xl border border-white/20 bg-white/10 p-6 shadow-2xl backdrop-blur-md sm:p-8"
        >
          <p className="text-sm font-medium text-white/90 sm:text-base">
            Algorithms calculate. Agents reason. Validators enforce.
          </p>
          <Link
            href="/dashboard"
            className="mt-5 inline-flex items-center justify-center rounded-lg bg-[#0E7A85] px-5 py-2.5 text-sm font-semibold text-white transition-all duration-150 ease-out hover:scale-[1.03] hover:bg-[#0c6871] active:scale-[0.98]"
          >
            Enter Command Center
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
