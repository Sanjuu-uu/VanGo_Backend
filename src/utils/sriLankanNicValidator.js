import dayjs from 'dayjs';

/**
 * Validates a Sri Lankan NIC and extracts the Date of Birth.
 * Supports both Old (9 digits + V/X) and New (12 digits) formats.
 */
export function extractDobFromNic(nic) {
  nic = nic.trim().toUpperCase();
  let birthYear, dayOfYear;

  // OLD FORMAT: e.g., 921234567V
  if (/^[0-9]{9}[V|X]$/.test(nic)) {
    birthYear = "19" + nic.substring(0, 2);
    dayOfYear = parseInt(nic.substring(2, 5), 10);
  } 
  // NEW FORMAT: e.g., 199212304567
  else if (/^[0-9]{12}$/.test(nic)) {
    birthYear = nic.substring(0, 4);
    dayOfYear = parseInt(nic.substring(4, 7), 10);
  } 
  else {
    return { isValid: false, error: "Invalid NIC format" };
  }

  // Determine Gender and adjust Day of Year (Females have 500 added to the day)
  const isFemale = dayOfYear > 500;
  if (isFemale) dayOfYear -= 500;

  // Validate day range
  if (dayOfYear < 1 || dayOfYear > 366) {
    return { isValid: false, error: "Invalid day of year in NIC" };
  }

  // Calculate exact Date of Birth
  // dayjs sets month to January (0) and adds the days
  const dob = dayjs(`${birthYear}-01-01`).add(dayOfYear - 1, 'day').format('YYYY-MM-DD');

  return {
    isValid: true,
    dob,
    gender: isFemale ? 'Female' : 'Male',
    birthYear
  };
}

/**
 * Compares the DOB extracted by AI with the math-calculated DOB.
 */
export function verifyNicMatchesDob(nicText, dobText) {
  const nicData = extractDobFromNic(nicText);
  if (!nicData.isValid) return { match: false, reason: nicData.error };

  // Convert the OCR dob text (which might be DD/MM/YYYY or YYYY.MM.DD) to standard format
  const parsedOcrDob = dayjs(dobText, ["DD/MM/YYYY", "YYYY-MM-DD", "DD.MM.YYYY", "YYYY.MM.DD"]);
  
  if (!parsedOcrDob.isValid()) {
    return { match: false, reason: "Could not parse Date of Birth from ID image" };
  }

  const match = nicData.dob === parsedOcrDob.format('YYYY-MM-DD');
  
  return {
    match,
    calculatedDob: nicData.dob,
    ocrDob: parsedOcrDob.format('YYYY-MM-DD'),
    reason: match ? "Valid" : "DOB on card does not match NIC mathematical validation (Possible Tampering)"
  };
}