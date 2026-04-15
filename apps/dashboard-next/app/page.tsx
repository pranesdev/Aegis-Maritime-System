'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function RootPage() {
  const router = useRouter()

  useEffect(() => {
    // Always redirect to login on page refresh/load for security
    localStorage.removeItem('role')
    localStorage.removeItem('token')
    router.push('/login')
  }, [router])

  return null
}
