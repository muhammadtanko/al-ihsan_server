-- AlterTable
ALTER TABLE "claim_documents" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'supporting',
ADD COLUMN     "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "uploadedBy" TEXT;
