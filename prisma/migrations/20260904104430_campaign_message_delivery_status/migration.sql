-- AlterTable
ALTER TABLE "CampaignMessage" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "failReason" TEXT,
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "readAt" TIMESTAMP(3);
