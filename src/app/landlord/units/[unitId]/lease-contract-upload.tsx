'use client'

import { useRef, useState } from 'react'
import { uploadLeaseContract } from '@/app/actions/admin'
import { Button } from '@/components/ui/button'
import { FileText, Upload, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

export function LeaseContractUpload({ leaseId, contractUrl }: { leaseId: string; contractUrl: string | null }) {
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const fd = new FormData()
    fd.set('contract', file)
    const result = await uploadLeaseContract(leaseId, fd)
    setUploading(false)
    if (result?.error) toast.error(result.error)
    else toast.success('Contract uploaded')
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="flex items-center gap-2">
      {contractUrl && (
        <a
          href={contractUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-md px-2 py-1 hover:border-slate-400 hover:bg-slate-50"
        >
          <FileText className="h-3 w-3" />
          View contract
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-xs h-auto py-1 px-2"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="h-3 w-3 mr-1" />
        {uploading ? 'Uploading…' : contractUrl ? 'Replace' : 'Upload contract'}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  )
}
