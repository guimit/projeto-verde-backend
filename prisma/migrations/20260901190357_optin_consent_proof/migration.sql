-- AlterTable
ALTER TABLE "OptInSession" ADD COLUMN     "consentAt" TIMESTAMP(3),
ADD COLUMN     "consentInboundId" TEXT,
ADD COLUMN     "consentText" TEXT;
