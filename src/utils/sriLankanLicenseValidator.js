import dayjs from 'dayjs';

/**
 * Cleans the AI extracted text to find just the NIC number.
 * Sri Lankan DLs often return "4c." or "4c" next to the Administrative number.
 */
function cleanNicString(rawText) {
  if (!rawText) return "";
  // Remove spaces, dots, and prefixes like '4c', '4c.', '4d', '4d.'
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
    birthYear = "19" + nic.substring(0, 2);
    dayOfYear = parseInt(nic.substring(2, 5), 10);
  } 
  // NEW FORMAT: e.g., 200606900123
  else if (/^[0-9]{12}$/.test(nic)) {
    birthYear = nic.substring(0, 4);
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

  const dob = dayjs(`${birthYear}-01-01`).add(dayOfYear - 1, 'day').format('YYYY-MM-DD');

  return { isValid: true, dob, gender: isFemale ? 'Female' : 'Male', birthYear };
}

/**
 * Compares the DOB extracted by AI with the math-calculated DOB from the NIC.
 */
export function verifyLicenseNicMatchesDob(nicText, dobText) {
  const nicData = extractDobFromNic(nicText);
  if (!nicData.isValid) return { match: false, reason: nicData.error };

  // FIX: Only remove '3' and '.' if they are at the VERY START of the string (^).
  // This prevents it from accidentally deleting the number 3 from the actual date (e.g. 03).
  const cleanDobText = dobText.replace(/^3[\.\s]*/i, '').trim();
  
  const parsedOcrDob = dayjs(cleanDobText, ["DD.MM.YYYY", "DD/MM/YYYY", "YYYY-MM-DD", "YYYY.MM.DD"]);
  
  if (!parsedOcrDob.isValid()) {
    return { 
      match: false, 
      calculatedDob: nicData.dob, // Added so your debug logs still print it
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