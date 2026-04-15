"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"

const NAV_LINKS = [
  { href: "/",     label: "Dashboard" },
  { href: "/logs", label: "Logs"      },
]

export default function Navbar() {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)

  // Hide navbar on login page
  if (pathname === "/login") {
    return null
  }

  const activeLabel = NAV_LINKS.find((l) => l.href === pathname)?.label ?? "Menu"

  return (
    <nav className="sticky top-0 z-[2000] w-full border-b border-[#1e3a5f]/50 bg-[#020817]/95 backdrop-blur-md">
      <div className="flex items-center justify-between px-3 md:px-6 h-14">

        {/* Logo */}
        <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
          <div className="w-8 h-8 rounded-full border border-cyan-400/60 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-cyan-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-tight">Smart Maritime Boundary Detection System</p>
            <p className="text-[10px] text-cyan-400/70 tracking-widest uppercase">AEGIS</p>
          </div>
        </div>

        {/* Desktop nav links */}
        <div className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                pathname === link.href
                  ? "text-cyan-400 bg-cyan-950/40 border border-cyan-500/30"
                  : "text-gray-400 hover:text-gray-200 hover:bg-[#1e3a5f]/30"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Mobile dropdown button */}
        <div className="md:hidden relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Open navigation menu"
            aria-expanded={menuOpen}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#1e3a5f] bg-[#0d2137] text-gray-300 text-sm font-medium"
          >
            <span>{activeLabel}</span>
            <svg
              className={`w-4 h-4 transition-transform duration-200 ${menuOpen ? "rotate-180" : ""}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {menuOpen && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => setMenuOpen(false)}
                aria-hidden="true"
              />
              <div className="absolute right-0 top-[calc(100%+4px)] w-44 rounded-xl border border-[#1e3a5f] bg-[#0d2137]/98 backdrop-blur-sm shadow-[0_8px_24px_rgba(0,0,0,0.5)] overflow-hidden z-50">
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMenuOpen(false)}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                      pathname === link.href
                        ? "text-cyan-400 bg-cyan-950/40"
                        : "text-gray-300 hover:bg-[#1e3a5f]/40 hover:text-gray-100"
                    }`}
                  >
                    {pathname === link.href && (
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0" />
                    )}
                    {link.label}
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>

      </div>
    </nav>
  )
}
