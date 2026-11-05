export const prerender = false;
import type { APIRoute } from 'astro';
import { db } from '@/db';
import { campaignSettings } from '@/db/schema';
import { requireAdminSession } from '@/lib/auth';
import { eq } from 'drizzle-orm';

const defaultFallbackSettings = {
  id: 1,
  hospitalCabinBn: 'ডিএমসিএইচ ১১৪/বি',
  hospitalCabinEn: 'DMCH Cabin 114/B',
  treatmentPhaseBn: 'আজ ৩য় দিনের কেমো চলছে',
  treatmentPhaseEn: 'Day 3 of Intensive Chemotherapy',
  doctorNameBn: 'ডা. হুমায়রা নাজনীন',
  doctorNameEn: 'Dr. Humayra Nazneen',
  dailyUpdateTextBn:
    'আজ আরাফের ৩য় দিনের কেমোথেরাপির জটিল চক্র চলছে। সেন্ট্রাল ভেনাস লাইন (সিভি লাইন)-এর মাধ্যমে একটানা উচ্চমাত্রার কেমো এবং ওষুধ চলায় ওর শরীর প্রচণ্ড দুর্বল। রক্তের প্লাটিলেট ও প্রয়োজনীয় সেল বারবার আশঙ্কাজনকভাবে কমে যাচ্ছে। সার্বক্ষণিক B+ হোল ব্লাড ও সিঙ্গেল ডোনার প্লাটিলেট (SDP) ব্যাকআপে রাখা অত্যন্ত জরুরি।',
  dailyUpdateTextEn:
    'Araf is currently on Day 3 of his intensive chemotherapy cycle. Continuous high-dose chemo and medications through his Central Venous (CV) line have made him extremely frail. His blood platelets and essential cells are rapidly falling to critical thresholds. Maintaining an immediate standby of B+ Whole Blood and Single Donor Platelets (SDP) is life-critical.',
  platelets: '36,000',
  wbc: '3,460',
  hb: '7.6',
  blast: '90%',
  creatinine: '0.2',
  uricAcid: '4.8',
  alt: '14.83',
  anc: '1,800',
  fundTarget: 4000000,
  fundRaised: 137841,
  emergencyTextBn:
    'হাসপাতাল কেবিন: ডিএমসিএইচ ১১৪/বি • আজ ৩য় দিনের কেমো চলছে • রক্তের গ্রুপ: B+ (বি পজিটিভ) • জরুরি B+ রক্ত ও প্লাটিলেট (SDP) প্রয়োজন',
  emergencyTextEn:
    'DMCH Cabin 114/B • Day 3 of Intensive Chemotherapy • Blood Group: B+ (Positive) • Urgent need for B+ Blood & SDP Platelets',
  enableScrolling: false,
  scrollSpeed: 20,
};

function toEnDigits(val: string): string {
  const bnToEnMap: Record<string, string> = {
    '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
    '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
  };
  return val.replace(/[০-৯]/g, (d) => bnToEnMap[d] || d);
}

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdminSession(request);
  if (!session?.user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Admin privileges required' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const [row] = await db
      .select()
      .from(campaignSettings)
      .where(eq(campaignSettings.id, 1))
      .limit(1);

    return new Response(
      JSON.stringify({
        success: true,
        settings: row || defaultFallbackSettings,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('Error fetching campaign settings:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch settings', details: err?.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdminSession(request);
  if (!session?.user) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Admin privileges required' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await request.json();
    const {
      hospitalCabinBn,
      hospitalCabinEn,
      treatmentPhaseBn,
      treatmentPhaseEn,
      doctorNameBn,
      doctorNameEn,
      dailyUpdateTextBn,
      dailyUpdateTextEn,
      platelets,
      wbc,
      hb,
      blast,
      creatinine,
      uricAcid,
      alt,
      anc,
      fundTarget,
      fundRaised,
      emergencyTextBn,
      emergencyTextEn,
      enableScrolling,
      scrollSpeed,
    } = body;

    const parsedFundTarget =
      fundTarget !== undefined && fundTarget !== null && fundTarget !== ''
        ? Number(fundTarget)
        : defaultFallbackSettings.fundTarget;
    const parsedFundRaised =
      fundRaised !== undefined && fundRaised !== null && fundRaised !== ''
        ? Number(fundRaised)
        : defaultFallbackSettings.fundRaised;

    const isScrollingEnabled =
      enableScrolling === true ||
      enableScrolling === 'true' ||
      enableScrolling === 1 ||
      enableScrolling === '1' ||
      enableScrolling === 'on';

    const parsedScrollSpeed =
      scrollSpeed !== undefined && scrollSpeed !== null && scrollSpeed !== ''
        ? Number(scrollSpeed)
        : defaultFallbackSettings.scrollSpeed;

    const valuesToSave = {
      id: 1,
      hospitalCabinBn:
        typeof hospitalCabinBn === 'string' && hospitalCabinBn.trim() !== ''
          ? hospitalCabinBn.trim()
          : defaultFallbackSettings.hospitalCabinBn,
      hospitalCabinEn:
        typeof hospitalCabinEn === 'string' && hospitalCabinEn.trim() !== ''
          ? hospitalCabinEn.trim()
          : defaultFallbackSettings.hospitalCabinEn,
      treatmentPhaseBn:
        typeof treatmentPhaseBn === 'string' && treatmentPhaseBn.trim() !== ''
          ? treatmentPhaseBn.trim()
          : defaultFallbackSettings.treatmentPhaseBn,
      treatmentPhaseEn:
        typeof treatmentPhaseEn === 'string' && treatmentPhaseEn.trim() !== ''
          ? treatmentPhaseEn.trim()
          : defaultFallbackSettings.treatmentPhaseEn,
      doctorNameBn:
        typeof doctorNameBn === 'string' && doctorNameBn.trim() !== ''
          ? doctorNameBn.trim()
          : defaultFallbackSettings.doctorNameBn,
      doctorNameEn:
        typeof doctorNameEn === 'string' && doctorNameEn.trim() !== ''
          ? doctorNameEn.trim()
          : defaultFallbackSettings.doctorNameEn,
      dailyUpdateTextBn:
        typeof dailyUpdateTextBn === 'string' && dailyUpdateTextBn.trim() !== ''
          ? dailyUpdateTextBn.trim()
          : defaultFallbackSettings.dailyUpdateTextBn,
      dailyUpdateTextEn:
        typeof dailyUpdateTextEn === 'string' && dailyUpdateTextEn.trim() !== ''
          ? dailyUpdateTextEn.trim()
          : defaultFallbackSettings.dailyUpdateTextEn,
      platelets:
        typeof platelets === 'string' && platelets.trim() !== ''
          ? toEnDigits(platelets.trim())
          : defaultFallbackSettings.platelets,
      wbc:
        typeof wbc === 'string' && wbc.trim() !== ''
          ? toEnDigits(wbc.trim())
          : defaultFallbackSettings.wbc,
      hb:
        typeof hb === 'string' && hb.trim() !== ''
          ? toEnDigits(hb.trim())
          : defaultFallbackSettings.hb,
      blast:
        typeof blast === 'string' && blast.trim() !== ''
          ? toEnDigits(blast.trim())
          : defaultFallbackSettings.blast,
      creatinine:
        typeof creatinine === 'string' && creatinine.trim() !== ''
          ? toEnDigits(creatinine.trim())
          : defaultFallbackSettings.creatinine,
      uricAcid:
        typeof uricAcid === 'string' && uricAcid.trim() !== ''
          ? toEnDigits(uricAcid.trim())
          : defaultFallbackSettings.uricAcid,
      alt:
        typeof alt === 'string' && alt.trim() !== ''
          ? toEnDigits(alt.trim())
          : defaultFallbackSettings.alt,
      anc:
        typeof anc === 'string' && anc.trim() !== ''
          ? toEnDigits(anc.trim())
          : defaultFallbackSettings.anc,
      fundTarget: isNaN(parsedFundTarget) ? defaultFallbackSettings.fundTarget : parsedFundTarget,
      fundRaised: isNaN(parsedFundRaised) ? defaultFallbackSettings.fundRaised : parsedFundRaised,
      emergencyTextBn:
        typeof emergencyTextBn === 'string' && emergencyTextBn.trim() !== ''
          ? emergencyTextBn.trim()
          : defaultFallbackSettings.emergencyTextBn,
      emergencyTextEn:
        typeof emergencyTextEn === 'string' && emergencyTextEn.trim() !== ''
          ? emergencyTextEn.trim()
          : defaultFallbackSettings.emergencyTextEn,
      enableScrolling: isScrollingEnabled,
      scrollSpeed: isNaN(parsedScrollSpeed) || parsedScrollSpeed <= 0 ? 20 : parsedScrollSpeed,
      updatedAt: new Date(),
    };

    await db
      .insert(campaignSettings)
      .values(valuesToSave)
      .onDuplicateKeyUpdate({
        set: {
          hospitalCabinBn: valuesToSave.hospitalCabinBn,
          hospitalCabinEn: valuesToSave.hospitalCabinEn,
          treatmentPhaseBn: valuesToSave.treatmentPhaseBn,
          treatmentPhaseEn: valuesToSave.treatmentPhaseEn,
          doctorNameBn: valuesToSave.doctorNameBn,
          doctorNameEn: valuesToSave.doctorNameEn,
          dailyUpdateTextBn: valuesToSave.dailyUpdateTextBn,
          dailyUpdateTextEn: valuesToSave.dailyUpdateTextEn,
          platelets: valuesToSave.platelets,
          wbc: valuesToSave.wbc,
          hb: valuesToSave.hb,
          blast: valuesToSave.blast,
          creatinine: valuesToSave.creatinine,
          uricAcid: valuesToSave.uricAcid,
          alt: valuesToSave.alt,
          anc: valuesToSave.anc,
          fundTarget: valuesToSave.fundTarget,
          fundRaised: valuesToSave.fundRaised,
          emergencyTextBn: valuesToSave.emergencyTextBn,
          emergencyTextEn: valuesToSave.emergencyTextEn,
          enableScrolling: valuesToSave.enableScrolling,
          scrollSpeed: valuesToSave.scrollSpeed,
          updatedAt: new Date(),
        },
      });

    const [updatedRow] = await db
      .select()
      .from(campaignSettings)
      .where(eq(campaignSettings.id, 1))
      .limit(1);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Campaign settings updated successfully',
        settings: updatedRow,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error('Error updating campaign settings:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to update campaign settings', details: err?.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const PUT = POST;
