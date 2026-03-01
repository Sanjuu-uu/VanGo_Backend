import dayjs from 'dayjs';

/**
 * Cleans the AI extracted text to find just the NIC number.
 */
function cleanNicString(rawText) {
  if (!rawText) return "";
  return rawText.replace(/4[cd]\.?/gi, '').replace(/\s/g, '').trim().toUpperCase();
}

/**
 * Validates a Sri Lankan NIC (found on the DL) and extracts the Date of Birth.
 */
export function extractDobFromNic(rawNic) {
  const nic = cleanNicString(rawNic);
  let birthYear, dayOfYear;

  // OLD FORMAT: e.g., 921234567V
  if (/^[0-9]{9}[V|X]$/.test(nic)) {
    birthYear = parseInt("19" + nic.substring(0, 2), 10);
    dayOfYear = parseInt(nic.substring(2, 5), 10);
  } 
  // NEW FORMAT: e.g., 200606900123
  else if (/^[0-9]{12}$/.test(nic)) {
    birthYear = parseInt(nic.substring(0, 4), 10);
    dayOfYear = parseInt(nic.substring(4, 7), 10);
  } 
  else {
    return { isValid: false, error: `Invalid NIC format detected: ${nic}` };
  }

  const isFemale = dayOfYear > 500;
  if (isFemale) dayOfYear -= 500;

  if (dayOfYear < 1 || dayOfYear > 366) {
    return { isValid: false, error: "Invalid day of year in NIC" };
  }

  // --- THE SRI LANKAN LEAP YEAR FIX ---
  // Sri Lankan NICs assume every year has 366 days.
  // We need to check if the actual birth year is a real leap year.
  const isLeapYear = (birthYear % 4 === 0 && (birthYear % 100 !== 0 || birthYear % 400 === 0));
  
  let dayAdjustment = 1;
  
  // If it's NOT a leap year, and the day is past February 28th (day 59), 
  // we must subtract 2 days to align the NIC calendar with the real-world calendar.
  if (!isLeapYear && dayOfYear > 59) {
    dayAdjustment = 2;
  }

  const dob = dayjs(`${birthYear}-01-01`).add(dayOfYear - dayAdjustment, 'day').format('YYYY-MM-DD');

  return { isValid: true, dob, gender: isFemale ? 'Female' : 'Male', birthYear };
}

/**
 * Compares the DOB extracted by AI with the math-calculated DOB from the NIC.
 */
export function verifyLicenseNicMatchesDob(nicText, dobText) {
  const nicData = extractDobFromNic(nicText);
  if (!nicData.isValid) return { match: false, reason: nicData.error };

  const cleanDobText = dobText.replace(/^3[\.\s]*/i, '').trim();
  const parsedOcrDob = dayjs(cleanDobText, ["DD.MM.YYYY", "DD/MM/YYYY", "YYYY-MM-DD", "YYYY.MM.DD"]);
  
  if (!parsedOcrDob.isValid()) {
    return { 
      match: false, 
      calculatedDob: nicData.dob, 
      ocrDob: "Invalid Date",
      reason: `Could not parse Date of Birth from text: ${cleanDobText}` 
    };
  }

  const match = nicData.dob === parsedOcrDob.format('YYYY-MM-DD');
  
  return {
    match,
    calculatedDob: nicData.dob,
    ocrDob: parsedOcrDob.format('YYYY-MM-DD'),
    reason: match ? "Valid" : `DOB on card (${parsedOcrDob.format('YYYY-MM-DD')}) does not match NIC validation (${nicData.dob})`
  };
}