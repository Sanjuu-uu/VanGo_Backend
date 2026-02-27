// config/app_strings.js

export const NOTIFICATION_STRINGS = {
  DRIVERS: {
    APPROVED: {
      title: "Account Approved! 🎉",
      body: "Congratulations! You are now approved to drive with VanGo.",
    },
    REJECTED: {
      title: "Action Required: Account Update",
      body: "There was an issue with your documents. Please open the app to review.",
    },
    PENDING: {
      title: "Profile Under Review",
      body: "We have received your details. Our team is currently reviewing your profile.",
    },
  },
  PARENTS: {
    WELCOME: {
      title: "Welcome to VanGo! 🎉",
      body: "Your parent profile has been successfully set up.",
    },
  },
  CHAT: {
    NEW_MESSAGE: "New Message",
  },
  EMERGENCIES: {
    // --- CRITICAL ---
    VEHICLE_BREAKDOWN: {
      title: "🔧 Vehicle Breakdown",
      body: "The vehicle has experienced a mechanical failure and cannot continue. A replacement is being coordinated.",
    },
    ACCIDENT: {
      title: "🚨 Accident Reported",
      body: "The vehicle has been involved in an accident. We are verifying passenger safety and will update you shortly.",
    },
    MEDICAL_EMERGENCY: {
      title: "🚑 Medical Emergency",
      body: "A medical emergency has been reported on board. Emergency services are being contacted.",
    },
    SECURITY_ISSUE: {
      title: "🛡️ Security Issue",
      body: "A security concern has been reported. Safety protocols have been activated.",
    },
    // --- SITUATIONAL ---
    TRAFFIC_DELAY: {
      title: "⏳ Traffic Delay",
      body: "The vehicle is experiencing heavy traffic. Expect a delay in arrival times.",
    },
    ROUTE_CHANGE: {
      title: "🗺️ Route Change",
      body: "The driver has taken an alternative route due to road conditions.",
    },
    OTHER: {
      title: "⚠️ Trip Update",
      body: "There is an update regarding the current trip. Please check the app for details.",
    },
    DEFAULT: {
      title: "⚠️ Emergency Alert",
      body: "An emergency has been reported. Please check the app for live status updates.",
    },
  },
};