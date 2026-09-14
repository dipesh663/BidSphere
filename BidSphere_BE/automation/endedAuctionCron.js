import cron from "node-cron";
import { Auction } from "../models/auctionSchema.js";
import { User } from "../models/userSchema.js";
import { Bid } from "../models/bidSchema.js";
import { sendEmail } from "../utils/sendEmail.js";
import { calculateCommission } from "../controllers/commissionController.js";

export const endedAuctionCron = () => {
  cron.schedule("*/1 * * * *", async () => {
    const now = new Date();
    console.log("Cron for ended auction running...");
    const endedAuctions = await Auction.find({
      endTime: { $lt: now },
      endedHandled: { $ne: true },
      commissionCalculated: { $ne: true },
    });
    for (const auction of endedAuctions) {
      try {
        auction.endedHandled = true;
        const highestBidder = await Bid.findOne({
          auctionItem: auction._id,
          amount: auction.currentBid,
        });
        const auctioneer = await User.findById(auction.createdBy);
        if (highestBidder) {
          auction.highestBidder = highestBidder.bidder.id;
          await auction.save();
          const bidder = await User.findById(highestBidder.bidder.id);
          if (bidder) {
            await User.findByIdAndUpdate(
              bidder._id,
              {
                $inc: {
                  auctionsWon: 1,
                },
              },
              { new: true }
            );
          }
          const subject = `Congratulations! You won the auction for ${auction.title}`;
          const message = `Dear ${bidder.userName}, \n\nCongratulations! You have won the auction for ${auction.title}. 
          \n\nBefore proceeding for payment contact your auctioneer via your auctioneer email:${auctioneer.email} 
          \n\nPlease complete your payment using one of the following methods:\n\n1. **Bank Transfer**: 
          \n- Account Name: ${auctioneer.paymentMethod.bankTransfer.bankAccountHolderName} 
          \n- Account Number: ${auctioneer.paymentMethod.bankTransfer.bankAccountNumber} 
          \n- Bank: ${auctioneer.paymentMethod.bankTransfer.bankName}\n\n2. **Khalti or Esewa**:
          \n- You can send payment via Khalti: ${auctioneer.paymentMethod.khalti.khaltiAccountNumber}
          \n- You can send payment via esewa: ${auctioneer.paymentMethod.esewa.esewaAccountNumber}
          \n\n3. **Cash on Delivery (COD)**:\n- If you prefer COD, you must pay 20% of the total amount upfront before delivery.
          \n- To pay the 20% upfront, use any of the above methods.\n- The remaining 80% will be paid upon delivery.
          \n- If you want to see the condition of your auction item then send your email on this: ${auctioneer.email}
          \n\nPlease ensure your payment is completed by [Payment Due Date]. Once we confirm the payment, the item will be shipped to you.
          \n\nThank you for participating!\n\nBest regards`;
          console.log("SENDING EMAIL TO HIGHEST BIDDER");
          sendEmail({ email: bidder.email, subject, message });
          console.log("SUCCESSFULLY EMAIL SEND TO HIGHEST BIDDER");
        } else {
          await auction.save();
        }
      } catch (error) {
        console.error("Error in ended auction cron:", error || "Some error in ended auction cron");
      }
    }
  });
};