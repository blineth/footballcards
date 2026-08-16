export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok && res.status !== 404 && res.status !== 502 && res.status !== 503) {
    throw new Error(`Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}
