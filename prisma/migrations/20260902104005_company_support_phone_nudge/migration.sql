-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "supportPhone" TEXT;

-- AlterTable
ALTER TABLE "OptInSession" ADD COLUMN     "lastNudgeAt" TIMESTAMP(3);
