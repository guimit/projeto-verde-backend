-- AlterTable
ALTER TABLE "User" DROP COLUMN "twoFactorEnabled",
DROP COLUMN "twoFactorSecret",
ADD COLUMN     "loginOtpCode" TEXT,
ADD COLUMN     "loginOtpExpires" TIMESTAMP(3);
