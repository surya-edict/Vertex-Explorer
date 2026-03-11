use windows::Win32::System::Ioctl::{MFT_ENUM_DATA_V1, USN_RECORD_V2};

fn main() {
    let enum_data = MFT_ENUM_DATA_V1 {
        StartFileReferenceNumber: 0,
        LowUsn: 0,
        HighUsn: std::i64::MAX,
        MinMajorVersion: 2,
        MaxMajorVersion: 3,
    };

    let usn_v2 = USN_RECORD_V2 {
        RecordLength: 0,
        MajorVersion: 0,
        MinorVersion: 0,
        FileReferenceNumber: 0,
        ParentFileReferenceNumber: 0,
        Usn: 0,
        TimeStamp: 0,
        Reason: 0,
        SourceInfo: 0,
        SecurityId: 0,
        FileAttributes: 0,
        FileNameLength: 0,
        FileNameOffset: 0,
        FileName: [0; 1],
    };
}
