-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('draft', 'pending', 'approved', 'rejected', 'paused');

-- CreateEnum
CREATE TYPE "TemplateHeaderType" AS ENUM ('none', 'text', 'image');

-- AlterTable: new template fields
ALTER TABLE "Template"
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "birdProjectId" TEXT,
ADD COLUMN     "birdVersionId" TEXT,
ADD COLUMN     "birdWabaId" TEXT,
ADD COLUMN     "buttons" JSONB,
ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'whatsapp',
ADD COLUMN     "footerText" TEXT,
ADD COLUMN     "headerText" TEXT,
ADD COLUMN     "headerType" "TemplateHeaderType" NOT NULL DEFAULT 'none',
ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'pt_BR',
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "status" "TemplateStatus" NOT NULL DEFAULT 'draft';

-- Preserve existing approval state before dropping the boolean column
UPDATE "Template" SET "status" = 'approved' WHERE "approved" = true;

-- Carry the old Bird link over to the renamed column, then drop the old one
UPDATE "Template" SET "birdProjectId" = "birdTemplateId" WHERE "birdTemplateId" IS NOT NULL;

ALTER TABLE "Template" DROP COLUMN "approved",
DROP COLUMN "birdTemplateId";

-- updatedAt: backfill existing rows, then hand control to Prisma's @updatedAt (no DB default)
ALTER TABLE "Template" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Template" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "filename" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
